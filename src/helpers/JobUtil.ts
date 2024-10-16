import { hpcConfigMap } from "../../configs/config";
// import path = require("path");
import { Job } from "../models/Job";
import dataSource from "../utils/DB";
import {
  slurm_integer_storage_unit_config,
  slurm_integer_time_unit_config,
  slurmInputRules,
  slurm_integer_configs,
  slurm
} from "../utils/types";

/**
 * Class providing various useful (static) functions for handling jobs. 
 */
export default class JobUtil {
  /**
   * Ensure the job has all the necessary input parameters
   *
   * @static
   * @param {Job} job - This job
   * @param { [keys: string]: unknown } paramRules - Parameter rules for this job
   * @throws Job must have a complete parameter list
   */
  static validateParam(job: Job, paramRules: Record<string, unknown>) {
    if (job.param === undefined) {
      throw new Error("job missing input params");
    }
    
    for (const i in paramRules) {
      if (!job.param[i]) {
        throw new Error(`job missing input param ${i}`);
      }
    }
  }

  /**
   * Get the total slurm usage of the indicated user
   *
   * @static
   * @async
   * @param {string} userID - User to collect slurm usage from
   * @param {boolean} format - Whether or not the cputume, memory, memoryusage, and walltime are already formatted
   * @returns {Record<string, number | string>} - Total slurm usage of the indicated user
   */
  static async getUserSlurmUsage(
    userId: string, 
    format = false
  ): Promise<Record<string, number | string>> {
    const jobs = await dataSource.getRepository(Job).findBy({ userId: userId });

    const userSlurmUsage = {
      nodes: 0,
      cpus: 0,
      cpuTime: 0,
      memory: 0,
      memoryUsage: 0,
      walltime: 0,
    };

    for (const job of jobs) {
      if (job.nodes) userSlurmUsage.nodes += job.nodes;
      if (job.cpus) userSlurmUsage.cpus += job.cpus;
      if (job.cpuTime) userSlurmUsage.cpuTime += job.cpuTime;
      if (job.memory) userSlurmUsage.memory += job.memory;
      if (job.memoryUsage) userSlurmUsage.memoryUsage += job.memoryUsage;
      if (job.walltime) userSlurmUsage.walltime += job.walltime;
    }

    if (format) {
      return {
        nodes: userSlurmUsage.nodes,
        cpus: userSlurmUsage.cpus,
        cpuTime: this.secondsToTimeDelta(userSlurmUsage.cpuTime),
        memory: this.kbToStorageUnit(userSlurmUsage.memory),
        memoryUsage: this.kbToStorageUnit(userSlurmUsage.memoryUsage),
        walltime: this.secondsToTimeDelta(userSlurmUsage.walltime),
      };
    } else {
      return {
        nodes: userSlurmUsage.nodes,
        cpus: userSlurmUsage.cpus,
        cpuTime: userSlurmUsage.cpuTime,
        memory: userSlurmUsage.memory,
        memoryUsage: userSlurmUsage.memoryUsage,
        walltime: userSlurmUsage.walltime,
      };
    }
  }
  
  /**
   * Ensure this job has valid input data and slurm config rules
   *
   * @static
   * @param {Job} job - This job
   * @param {string} jupyterHost - Jupyter host for this job
   * @param {string} username - Username of the user who submitted this job
   * @throws - DataFolder must have a valid path, the job must have upload data, and there must be an executable folder in the maintainerConfig
   */
  static validateJob(job: Job) {
    // create slurm config rules
    const providedSlurmInputRules: slurmInputRules = {};
    const providedParamRules: Record<string, unknown> = {};
    const requireUploadData = false;

    if (requireUploadData && !job.localDataFolder && !job.remoteDataFolder) {
      throw new Error("job missing data file");
    }
    if (job.localExecutableFolder === undefined) {
      throw new Error("job missing executable file");
    }

    JobUtil.validateSlurmConfig(job, providedSlurmInputRules);
    JobUtil.validateParam(job, providedParamRules);
  }

  /**
   * Set the slurm rules for this job, and ensure that those rules don't exceed the default slurm ceiling
   *
   * @static
   * @param {Job} job - This job
   * @param {slurmInputRules} slurmInputRules - Slurm input rules associated with this job
   * @throws - Slurm input rules associated with this job must not exceed the default slurm ceiling
   */
  static validateSlurmConfig(job: Job, slurmInputRules: slurmInputRules) {
    const slurmCeiling: Record<string, unknown> = {};
    let globalInputCap = hpcConfigMap[job.hpc].slurm_global_cap;
    if (!globalInputCap) globalInputCap = {};
    slurmInputRules = Object.assign(
      hpcConfigMap[job.hpc].slurm_input_rules as Record<string, unknown>,
      slurmInputRules
    );

    const defaultSlurmCeiling = {
      num_of_node: 50,
      num_of_task: 50,
      cpu_per_task: 50,
      memory_per_cpu: "10G",
      memory_per_gpu: "10G",
      memory: "50G",
      gpus: 20,
      gpus_per_node: 20,
      gpus_per_socket: 20,
      gpus_per_task: 20,
      time: "10:00:00",
    };

    // TODO: fix this entire thing -- type assertions are iffy

    for (const rule_name in slurmInputRules) {
      const rule = slurmInputRules[rule_name as keyof slurmInputRules];
      if (!rule || !("max" in rule)) continue;

      if (slurm_integer_storage_unit_config.includes(rule_name)) {
        slurmCeiling[rule_name] = rule.max + rule.unit;
      } else if (slurm_integer_time_unit_config.includes(rule_name)) {
        const val = rule.max;
        const unit = rule.unit;
        const sec = JobUtil.unitTimeToSeconds(val!, unit);

        slurmCeiling[rule_name] = JobUtil.secondsToTime(sec);
      } else if (slurm_integer_configs.includes(rule_name)) {
        slurmCeiling[rule_name] = rule.max;
      }
    }

    for (const field in globalInputCap) {
      const val = globalInputCap[field as keyof slurm];
      
      if (!val) slurmCeiling[field] = val;
      else if (val && typeof val === "string" && 
        this.compareSlurmConfig(
          field, 
          val, 
          slurmCeiling[field] as string
        )
      ) {
        slurmCeiling[field] = val;
      }
    }

    for (const field in defaultSlurmCeiling) {
      if (!slurmCeiling[field]) {
        slurmCeiling[field] = defaultSlurmCeiling[field as keyof typeof defaultSlurmCeiling];
        continue;
      }
    }

    for (const field in slurmCeiling) {
      const val = job.slurm?.[field as keyof slurm];

      if (!val) continue;
      
      if (typeof val === "string" && this.compareSlurmConfig(
        field, 
        slurmCeiling[field as keyof slurm] as string, 
        val)
      ) {
        throw new Error(
          `slurm config ${field} exceeds the threshold of ${slurmCeiling[field as keyof slurm] as string} (current value ${val})`
        );
      }
    }
  }

  /**
   * Return true if the slurm config exceeds the threshold of the slurm ceiling.
   *
   * @static
   * @param {string} i - Slurm field that a and b are associated with
   * @param {string} a - Storage or projected time for this job from the slurm ceiling
   * @param {string} b - Storage or projected time for this job for this job
   * @return {boolean} - If the slurm config exceeds the threshold of the slurm ceiling
   */
  static compareSlurmConfig(i: string, a: string, b: string): boolean {
    if (slurm_integer_storage_unit_config.includes(i)) {
      return this.storageUnitToKB(a) < this.storageUnitToKB(b);
    }
    if (slurm_integer_time_unit_config.includes(i)) {
      return this.timeToSeconds(a) < this.timeToSeconds(b);
    }
    return a < b;
  }

  /**
   * Turns the passed amount of storage into kb
   *
   * @static
   * @param {string} i - Amount of storage in original unit
   * @return {number} - Storage in kb
   */
  static storageUnitToKB(i: string): number {
    i = i.toLowerCase().replace(/b/gi, "");

    // petabytes
    if (i.includes("p")) {
      return parseInt(i.replace("p", "").trim()) * 1024 * 1024 * 1024 * 1024;
    }

    // terabytes
    if (i.includes("t")) {
      return parseInt(i.replace("t", "").trim()) * 1024 * 1024 * 1024;
    }

    // gigabytes
    if (i.includes("g")) {
      return parseInt(i.replace("g", "").trim()) * 1024 * 1024;
    }

    // megabytes
    if (i.includes("m")) {
      return parseInt(i.replace("m", "").trim()) * 1024;
    }

    // kilobytes
    return parseInt(i.trim());
  }

  /**
   * Turns the passed amount of storage into the most convenient unit.
   *
   * @static
   * @param {number} i - Amount of storage in kb
   * @return {string} - Storage in most convenient unit (kb, mb, gb, tb, pb, eb)
   */
  static kbToStorageUnit(i: number) {
    const units = ["kb", "mb", "gb", "tb", "pb", "eb"].reverse();
    while (units.length > 0) {
      const unit = units.pop();
      if (i < 1024) return `${i}${unit}`;
      i = i / 1024;
    }
    return `${i}pb`;
  }
  /**
   * Turns the passed time into a string specifying each unit
   *
   * @static
   * @param {number} seconds_in - Time in seconds
   * @return {string} - Passed time converted into dayds, hours, minutes, seconds format
   */
  static secondsToTimeDelta(seconds_in: number) {
    const days = Math.floor(seconds_in / (60 * 60 * 24));
    const hours = Math.floor(seconds_in / (60 * 60) - days * 24);
    const minutes = Math.floor(seconds_in / 60 - days * 60 * 24 - hours * 60);
    const seconds = Math.floor(
      seconds_in - days * 60 * 60 * 24 - hours * 60 * 60
    );

    const format = (j: number) => {
      if (j === 0) return "00";
      else if (j < 10) return `0${j}`;
      else return `${j}`;
    };
    return `${format(days)} days, ${format(hours)} hours, ${format(
      minutes
    )} minutes, ${format(seconds)} seconds`;
  }
  /**
   * Turns the passed time into seconds
   *
   * @static
   * @param {number} time - Time in specified unit
   * @param {string} unit - Unit the passed time is in
   * @return {int} - Passed time converted into seconds
   */
  static unitTimeToSeconds(time: number, unit: string) {
    if (unit === "Minutes") return time * 60;
    if (unit === "Hours") return time * 60 * 60;
    if (unit === "Days") return time * 60 * 60 * 24;
    return 0;
  }
  /**
   * Turns passed seconds time into days-hours:minutes:seconds format
   *
   * @static
   * @param {number} seconds - Time in seconds
   * @return {int} time - Passed seconds time converted to days-hours:minutes:seconds format.
   */
  static secondsToTime(seconds: number) {
    const days = Math.floor(seconds / (60 * 60 * 24));
    const hours = Math.floor(seconds / (60 * 60) - days * 24);
    const minutes = Math.floor(seconds / 60 - days * 60 * 24 - hours * 60);

    const d = days < 10 ? `0${days}` : `${days}`;
    const h = hours < 10 ? `0${hours}` : `${hours}`;
    const m = minutes < 10 ? `0${minutes}` : `${minutes}`;

    if (days === 0) {
      if (hours === 0) {
        return `${m}:00`;
      } else {
        return `${h}:${m}:00`;
      }
    } else {
      return `${d}-${h}:${m}:00`;
    }
  }

  /**
   * Turns passed days-hours:minutes:seconds time into seconds format
   *
   * @static
   * @param {string} raw - Time in days-hours:minutes:seconds format.
   * @return {int} - Passed days-hours:minutes:seconds time converted to seconds.
   */
  static timeToSeconds(raw: string) {
    const i = raw.split(":");
    if (i.length === 1) {
      const j = i[0].split("-");
      if (j.length === 1) {
        // minutes
        return parseInt(i[0]) * 60;
      } else {
        // days-hours
        return parseInt(j[0]) * 60 * 60 * 24 + parseInt(j[0]) * 60 * 60;
      }
    } else if (i.length === 2) {
      const j = i[0].split("-");
      if (j.length === 2) {
        // days-hours:minutes
        return (
          parseInt(j[0]) * 60 * 60 * 24 +
          parseInt(j[1]) * 60 * 60 +
          parseInt(i[1]) * 60
        );
      } else {
        // minutes:seconds
        return parseInt(i[0]) * 60 + parseInt(i[0]);
      }
    } else if (i.length === 3) {
      const j = i[0].split("-");
      if (j.length === 2) {
        // days-hours:minutes:seconds
        return (
          parseInt(j[0]) * 60 * 60 * 24 +
          parseInt(j[1]) * 60 * 60 +
          parseInt(i[1]) * 60 +
          parseInt(i[2])
        );
      } else {
        // hours:minutes:seconds
        return parseInt(i[0]) * 60 * 60 + parseInt(i[1]) * 60 + parseInt(i[2]);
      }
    }
    return Infinity;
  }
}
