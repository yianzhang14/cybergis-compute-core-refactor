import * as path from "path";

import { containerConfigMap, hpcConfigMap, kernelConfigMap } from "../../configs/config";
import * as Helper from "../helpers/Helper";
import { slurm, executableManifest } from "../utils/types";

import SlurmConnector from "./SlurmConnector";
// import { kernelConfig } from "../types";

/**
 * Specialization of SlurmConnector that, in addition to supporting ssh/slurm jobs, connects a given singularity container to the HPC environment.
 *
 * @class SingularityConnector
 * @extends {SlurmConnector}
 */
class SingularityConnector extends SlurmConnector {

  private volumeBinds: Record<string, string> = {};
  public isContainer = true;  // this is a container -- causes some changes in how job JSONs are generated

  /**
   * Executes specified command within specified image
   *
   * @param {string} image - docker image
   * @param {string} cmd - command to be executed
   * @param {slurm} config - slurm configuration
   */
  execCommandWithinImage(image: string, cmd: string, config: slurm) {
    if (this.is_cvmfs){
      cmd = `srun --mpi=pmi2 singcvmfs -s exec ${this._getVolumeBindCMD()} -cip docker://cybergisx/compute-cvmfs:0.1.0 ${cmd}`;
    }
    else{
      cmd = `srun --mpi=pmi2 singularity exec ${this._getVolumeBindCMD()} ${image} ${cmd}`;
    }

    super.prepare(cmd, config);
  }

  /**
   * Executes specified manifest within image
   *
   * @param {executableManifest} manifest - manifest that needs toe be executed
   * @param {slurm} config - slurm configuration
   * @throw {Error} - thrown when container is not supported
   */
  async execExecutableManifestWithinImage(
    manifest: executableManifest,
    config: slurm
  ) {
    let containerPath!: string;
    if(!this.is_cvmfs){
      const container = containerConfigMap[manifest.container];
      if (!container) throw new Error(`unknown container ${manifest.container}`);

      containerPath = container.hpc_path[this.hpcName];
      if (!containerPath)
        throw new Error(
          `container ${manifest.container} is not supported on HPC ${this.hpcName}`
        );
      // remove buffer: https://dashboard.hpc.unimelb.edu.au/job_submission/
    }

    const jobENV = this._getJobENV();
    let cmd = "";

    if (manifest.pre_processing_stage_in_raw_sbatch) {
      for (const stage of manifest.pre_processing_stage_in_raw_sbatch) {
        cmd += `${stage}\n`;
      }
    } else if (manifest.pre_processing_stage) {
      if (this.is_cvmfs){
        cmd += `${jobENV.join(
          " "
        )} singcvmfs -s exec ${this._getVolumeBindCMD()} -cip docker://cybergisx/compute-cvmfs:0.1.0 bash -c "cd ${this.getContainerExecutableFolderPath()} && source kernel_init.sh && ${
          manifest.pre_processing_stage
        }"\n\n`;

      } else {
        cmd += `${jobENV.join(" ")} singularity exec ${this._getVolumeBindCMD(
          manifest
        )} ${containerPath} bash -c "cd ${this.getContainerExecutableFolderPath()} && ${
          manifest.pre_processing_stage
        }"\n\n`;

      }
    }

    if (manifest.execution_stage_in_raw_sbatch) {
      for (const stage of manifest.execution_stage_in_raw_sbatch) {
        cmd += `${stage}\n`;
      }
    } else {
      if (this.is_cvmfs){
        await this.createKernelInit(manifest);
        cmd += `${jobENV.join(
          " "
        )} srun --unbuffered --mpi=pmi2 singcvmfs -s exec ${this._getVolumeBindCMD()} -cip docker://cybergisx/compute-cvmfs:0.1.0 bash -c "cd ${this.getContainerExecutableFolderPath()} && source kernel_init.sh && ${
          manifest.execution_stage
        }"\n\n`;

      } else{
        cmd += `${jobENV.join(
          " "
        )} srun --unbuffered --mpi=pmi2 singularity exec ${this._getVolumeBindCMD(
          manifest
        )} ${containerPath} bash -c "cd ${this.getContainerExecutableFolderPath()} && ${
          manifest.execution_stage
        }"\n\n`;

      }
    }

    if (manifest.post_processing_stage_in_raw_sbatch) {
      for (const stage of manifest.post_processing_stage_in_raw_sbatch) {
        cmd += `${stage}\n`;
      }

    } else if (manifest.post_processing_stage) {
      if(this.is_cvmfs){
        cmd += `${jobENV.join(
          " "
        )} singcvmfs -s exec ${this._getVolumeBindCMD()} -cip docker://cybergisx/compute-cvmfs:0.1.0 bash -c "cd ${this.getContainerExecutableFolderPath()} && source kernel_init.sh && ${
          manifest.post_processing_stage
        }"`;

      } else {
        cmd += `${jobENV.join(" ")} singularity exec ${this._getVolumeBindCMD(
          manifest
        )} ${containerPath} bash -c "cd ${this.getContainerExecutableFolderPath()} && ${
          manifest.post_processing_stage
        }"`;

      }
    }

    super.prepare(cmd, config);
  }

  /**
   * Runs singularity image
   *
   * @param {string} image - singularity image
   * @param {slurm} config - slurm configuration
   */
  runImage(image: string, config: slurm) {
    const jobENV = this._getJobENV();

    let cmd: string;
    if (this.is_cvmfs){
      cmd = `srun --mpi=pmi2 ${jobENV.join(
        " "
      )} singcvmfs -s exec ${this._getVolumeBindCMD()} -cip ${image}`;
    } else{
      cmd = `srun --mpi=pmi2 ${jobENV.join(
        " "
      )} singularity run ${this._getVolumeBindCMD()} ${image}`;
    }

    super.prepare(cmd, config);
  }

  /**
   * Registers volumeBinds
   *
   * @param {{[keys: string]: string}} volumeBinds - volumeBinds that need to be registered
   */
  registerContainerVolumeBinds(volumeBinds: Record<string, string>) {
    for (const from in volumeBinds) {
      const to = volumeBinds[from];
      this.volumeBinds[from] = to;
    }
  }

  /**
   * @private
   * Returns volumeBinds
   *
   * @param {executableManifest} manifest - manifest containing volumeBinds
   * @return {string | {[keys: string]: string}} volumeBinds
   */
  private _getVolumeBindCMD(
    manifest: executableManifest | null = null
  ): string {
    if (this.is_cvmfs){
      this.volumeBinds.$tmp_path = this.getContainerCVMFSFolderPath();
    }

    this.volumeBinds[this.getRemoteExecutableFolderPath()] =
      this.getContainerExecutableFolderPath();
    this.volumeBinds[this.getRemoteResultFolderPath()] =
      this.getContainerResultFolderPath();

    if (this.getRemoteDataFolderPath()) {
      this.volumeBinds[this.getRemoteDataFolderPath()!] =
        this.getContainerDataFolderPath();
    }

    if (manifest && !this.is_cvmfs) {
      const hpc = hpcConfigMap[this.hpcName];
      if (hpc?.mount) {
        for (const i in hpc.mount){
          this.volumeBinds[i] = hpc.mount[i];
        }
      }

      const container = containerConfigMap[manifest.container];
      if (container?.mount?.[this.hpcName]) {
        for (const i in container.mount[this.hpcName]) {
          this.volumeBinds[i] = container.mount[this.hpcName][i];
        }
      }
    }

    const bindCMD: string[] = [];
    for (const from in this.volumeBinds) {
      const to = this.volumeBinds[from];
      bindCMD.push(`${from}:${to}`);
    }
    
    if (this.is_cvmfs){
      return `-B ${bindCMD.join(",")}`;
    } else {
      return `--bind ${bindCMD.join(",")}`;
    }
  }

  /**
   * Returns job environment
   *
   * @return {string[]} jobENV - jobenvironment variables
   */
  private _getJobENV(): string[] {
    Helper.nullGuard(this.maintainer);

    const jobJSON = {
      job_id: this.maintainer.job.id,
      user_id: this.maintainer.job.userId,
      maintainer: this.maintainer.job.maintainer,
      hpc: this.maintainer.job.hpc,
      param: this.maintainer.job.param,
      env: this.maintainer.job.env,
      executable_folder: this.isContainer
        ? this.getContainerExecutableFolderPath()
        : this.getRemoteExecutableFolderPath(),
      data_folder: this.isContainer
        ? this.getContainerDataFolderPath()
        : this.getRemoteDataFolderPath(),
      result_folder: this.isContainer
        ? this.getContainerResultFolderPath()
        : this.getRemoteResultFolderPath(),
    };

    const jobENV: string[] = [];
    const structuredKeys = ["param", "env"];
    for (const key of Object.keys(jobJSON)) {
      if (structuredKeys.includes(key)) {
        for (const i in (
          jobJSON[key as keyof typeof jobJSON]) as Record<string, string>
        ) {
          jobENV.push(`${key}_${i}="${(jobJSON[key as keyof typeof jobJSON] as Record<string, string>)[i]}"`);
        }
      } else {
        jobENV.push(`${key}="${(jobJSON[key as keyof typeof jobJSON] as string | null | undefined) ?? ""}"`);
      }
    }

    return jobENV;
  }

  /**
   * Creates a bash script using kernelConfig
   * @param{executableManifest} manifest - manifest that needs toe be executed
   */
  async createKernelInit(manifest: executableManifest){
    let kernelBash = "#!/bin/bash\n";
    kernelBash+= `${kernelConfigMap[manifest.container].env.join("\n")}`;
    
    await this.createFile(
      kernelBash,
      path.join(this.getRemoteExecutableFolderPath(), "kernel_init.sh")
    );
  }
}

export default SingularityConnector;
