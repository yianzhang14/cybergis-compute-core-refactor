import NodeSSH = require("node-ssh");

import * as events from "events";

import { config, maintainerConfigMap, hpcConfigMap } from "../../configs/config";
import connectionPool from "../connectors/ConnectionPool";
import * as Helper from "../helpers/Helper";
import BaseMaintainer from "../maintainers/BaseMaintainer";
import { Job } from "../models/Job";

import dataSource from "./DB";
import Emitter from "./Emitter";
import { JobQueue } from "./Redis";
import { SSH, callableFunction } from "./types";

/**
 * Manages 
 */
class Supervisor {

  // these maps keep track of the various hpcs
  private jobPoolCapacities: Record<string, number> = {};  // capacity
  private jobPoolCounters: Record<string, number> = {};  // current size
  private queues: Record<string, JobQueue> = {};  // queues of jobs
  private runningJobs: Record<string, Job[]> = {};  // running jobs
  private cancelJobs: Record<string, Job[]> = {};  // what jobs to cancel

  private emitter = new Emitter();  // emitter reference

  private maintainerMasterThread: NodeJS.Timeout | null = null;  // main loop

  private maintainerMasterEventEmitter = new events.EventEmitter();

  private queueConsumeTimePeriodInSeconds =
    config.queue_consume_time_period_in_seconds;

  /**
   * Constructs the supervisor. Populates the instance variables with trackers for all the HPCs in the config. Creates the 
   * master maintainer. 
   */
  constructor() {
    for (const hpcName in hpcConfigMap) {
      const hpcConfig = hpcConfigMap[hpcName];

      // register job pool & queues
      this.jobPoolCapacities[hpcName] = hpcConfig.job_pool_capacity;
      this.jobPoolCounters[hpcName] = 0;
      this.queues[hpcName] = new JobQueue(hpcName);
      this.runningJobs[hpcName] = new Array<Job>();
      this.cancelJobs[hpcName] = new Array<Job>();
    }

    this.createMaintainerMaster();
  }


  /**
   * Creates the main maintainer for all job execution. Runs in an infinite spaced loop. Ends on destruction. 
   */
  createMaintainerMaster() {
    // queue consumer
    // this function defined here will repeat every x seconds (specified in second parameter)
    this.maintainerMasterThread = setInterval(async () => {

      // iterate over all HPCs
      for (const hpcName in this.jobPoolCounters) {

        // try to fill in the current HPC with jobs
        while (
          this.jobPoolCounters[hpcName] < this.jobPoolCapacities[hpcName] &&
          !(await this.queues[hpcName].isEmpty())
        ) {
          const job = await this.queues[hpcName].pop();
          if (!job) continue;

          // eslint-disable-next-line
          const maintainer: new(job: Job) => BaseMaintainer = require(`../maintainers/${
            maintainerConfigMap[job.maintainer].maintainer
          }`).default;  // eslint-disable-line
            // ^ typescript compilation hack 
            // TODO: don't do this

          try {
            // push the job
            job.maintainerInstance = new maintainer(job);
            this.runningJobs[job.hpc].push(job);
            if (config.is_testing) console.log(`Added job to running jobs: ${job.id}`);
          } catch (e) {
            // log error and skip job
            await this.emitter.registerEvents(
              job,
              "JOB_INIT_ERROR",
              `job [${job.id}] failed to initialized with error ${Helper.assertError(e).toString()}`
            );

            job.finishedAt = new Date();

            await dataSource
              .createQueryBuilder()
              .update(Job)
              .where("id = :id", { id: job.id })
              .set({ finishedAt: job.finishedAt })
              .execute();
            continue;
          }

          this.jobPoolCounters[hpcName]++;

          // manage ssh pool -- diferent behavior for community/noncommunity accounts
          if (job
            .maintainerInstance
            .connector?.connectorConfig
            .is_community_account
          ) {
            connectionPool[job.hpc].counter++;
          } else {
            const hpcConfig = hpcConfigMap[job.hpc];
            connectionPool[job.id] = {
              counter: 1,
              ssh: {
                connection: new NodeSSH(),
                config: {
                  host: hpcConfig.ip,
                  port: hpcConfig.port,
                  username: job.credential?.user,
                  password: job.credential?.password,
                  readyTimeout: 1000,
                },
              },
            };
          }

          // emit event
          await this.emitter.registerEvents(
            job,
            "JOB_REGISTERED",
            `job [${job.id}] is registered with the supervisor, waiting for initialization`
          );

          // run worker
          await this.createMaintainerWorker(job);
        }
      }
    }, this.queueConsumeTimePeriodInSeconds * 1000);

    // remove job once ended
    this.maintainerMasterEventEmitter.on("job_end", (hpcName: string, jobName: string) => {
      if (config.is_testing) console.log(`received job_end event from ${jobName}`);
      this.jobPoolCounters[hpcName]--;
    });
  }

  /**
   * Creates an object that keeps track of a job throughout its lifecycle on the HPC, recording changes in internal variables. 
   *
   * @param {Job} job
   */
  async createMaintainerWorker(job: Job) {
    Helper.nullGuard(job.maintainerInstance);  // should have been initialized on job creation
    // const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // keep looping while the job is not finished
    while (true) {  // eslint-disable-line no-constant-condition
      // get ssh connector from pool
      let ssh: SSH;
      if (job
        .maintainerInstance?.connector?.connectorConfig
        .is_community_account
      ) {
        ssh = connectionPool[job.hpc].ssh;
      } else {
        ssh = connectionPool[job.id].ssh;
      }

      if (!ssh.connection.isConnected()) {
        try {
          // wraps command with backoff -> takes lambda function and array of inputs to execute command
          await Helper.runCommandWithBackoff((async (ssh1: SSH) => {
            if (!ssh1.connection.isConnected()) {
              await ssh1.connection.connect(ssh1.config);
            }
            await ssh1.connection.execCommand("echo");
          }) as callableFunction, [ssh], null);
        } catch (e) {
          console.log(`job [${job.id}]: Caught ${Helper.assertError(e).toString()}`);
          await this.emitter.registerEvents(
            job,
            "JOB_FAILED",
            `job [${job.id}] failed because the HPC could not connect within the allotted time`
          );
        }
        
      }

      if (job.maintainerInstance.isInit) {
        await job.maintainerInstance.maintain();
      } else {
        await job.maintainerInstance.init();
      }
      // emit events & logs
      const events = job.maintainerInstance.dumpEvents();
      const logs = job.maintainerInstance.dumpLogs();

      // TODO: no need to dump events or logs outside the maintainer
      for (const event of events)
        await this.emitter.registerEvents(job, event.type, event.message);
      for (const log of logs) await this.emitter.registerLogs(job, log);

      // check if job should be canceled
      let shouldCancel = false;
      for (const hpcJob of this.cancelJobs[job.hpc]) {
        if (hpcJob === job) {
          shouldCancel = true;
        }
      }
      
      if (shouldCancel && job.maintainerInstance.jobOnHpc) {
        await job.maintainerInstance.onCancel();
        const index = this.cancelJobs[job.hpc].indexOf(job, 0);
        if (index > -1) {
          this.cancelJobs[job.hpc].splice(index, 1);
        }
      }

      // ending conditions
      if (job.maintainerInstance.isEnd) {
        // exit or deflag ssh pool
        if (job
          .maintainerInstance
          .connector?.connectorConfig
          .is_community_account
        ) {
          connectionPool[job.hpc].counter--;
          if (connectionPool[job.hpc].counter === 0) {
            if (ssh.connection.isConnected()) ssh.connection.dispose();
          }
        } else {
          if (ssh.connection.isConnected()) ssh.connection.dispose();
          delete connectionPool[job.id];
        }

        // emit event
        this.maintainerMasterEventEmitter.emit("job_end", job.hpc, job.id);

        // remove from running jobs
        let index = this.runningJobs[job.hpc].indexOf(job, 0);
        if (index > -1) {
          this.runningJobs[job.hpc].splice(index, 1);
          if (config.is_testing) console.log(`Removed job from running jobs: ${job.id}`);
        }

        index = this.cancelJobs[job.hpc].indexOf(job, 0);
        if (index > -1) {
          this.cancelJobs[job.hpc].splice(index, 1);
        }

        // exit loop
        return;
      }
    }
  }


  /**
   * Adds a job to the job queue. 
   *
   * @param {Job} job job to add
   */
  async pushJobToQueue(job: Job) {
    await this.queues[job.hpc].push(job);
    await this.emitter.registerEvents(
      job,
      "JOB_QUEUED",
      "job [" + job.id + "] is queued, waiting for registration"
    );
  }

  /**
   * Stops the master thread execution. 
   */
  destroy() {
    clearInterval(this.maintainerMasterThread ?? undefined);
  }


  /**
   * Cancels the job associated with the given job id. 
   *
   * @param {string} jobId
   * @return {Job | null} the job that was cancelled
   */
  cancelJob(jobId: string): Job | null {
    if (config.is_testing) console.log(`cancelJob(${jobId}) looking for job`);
    let toReturn: Job | null = null;
    let hpcToAdd: string | null = null;

    // look for the job across all hpcs
    for (const hpc in hpcConfigMap) {
      // // look for any jobs queued up TODO: fix this
      // for (let i = 0; i < await this.queues[hpc].length(); i++) {
      //   console.log(`Queue: checking is ${this.queues[hpc][i].id.toString()}`);
      //   if (this.queues[hpc][i].id.toString() === jobId.toString()) {
      //     toReturn = this.queues[hpc][i];
      //     hpcToAdd = hpc;
      //   }
      // }

      // look for the job in the running jobs
      if (config.is_testing) {
        console.log(`looking in ${hpc}`);
        
        for (const job of this.runningJobs[hpc]) {
          console.log(`RunningJobs: checking is ${job.id.toString()}`);
          if (job.id === jobId.toString()) {
            toReturn = job;
            hpcToAdd = hpc;
          }
        }
      }
      
    }
    
    // if found, cancel it; otherwise log it
    if (toReturn !== null && hpcToAdd !== null) {
      this.cancelJobs[hpcToAdd].push(toReturn);
    } else {
      console.log("Supervisor getJob(" + jobId + "): job not found");
    }

    return toReturn;
  }
}

export default Supervisor;

