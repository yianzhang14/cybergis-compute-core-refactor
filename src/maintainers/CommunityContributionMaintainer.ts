import SingularityConnector from "../connectors/SingularityConnector";
import GitUtil from "../helpers/GitUtil";
import * as Helper from "../helpers/Helper";
import XSEDEUtil from "../helpers/XSEDEUtil";
import { Folder } from "../models/Folder";
import { Git } from "../models/Git";
import dataSource from "../utils/DB";
import { BaseFolderUploader, FolderUploaderHelper } from "../utils/FolderUploader";
import { ResultFolderContentManager } from "../utils/Redis";
import { executableManifest, GitFolder } from "../utils/types";

import BaseMaintainer from "./BaseMaintainer";

/**
 * Specialized maintainer for handling jobs submitted to community HPCs (no login). Inherits from BaseMaintainer.
 */
class CommunityContributionMaintainer extends BaseMaintainer {

  declare public connector: SingularityConnector;  // connector to communicate with HPC

  public resultFolderContentManager: ResultFolderContentManager =
    new ResultFolderContentManager();

  public executableManifest!: executableManifest;  // details about the job

  onDefine() {
    this.connector = this.getSingularityConnector();
  }

  /**
   * On maintainer initialization, set executableManifest, and give it to the connector. 
   * Update the event log to reflect the job being initialized or encountering a system error.
   *
   * @async
   */
  async onInit() {
    try {
      let localExecutableFolder: GitFolder;
      if (
        typeof this.job.localExecutableFolder === "object" &&
        this.job.localExecutableFolder !== null &&
        "type" in this.job.localExecutableFolder &&
        "gitId" in this.job.localExecutableFolder &&
        this.job.localExecutableFolder.type === "git"
      ) {
        localExecutableFolder = this.job.localExecutableFolder;
      } else {
        throw new Error(
          "community contribution currently doesn't accept non-git code or folder specification was malformed"
        );
      }

      // get executable manifest
      const git = await dataSource
        .getRepository(Git)
        .findOneBy({ id: (localExecutableFolder).gitId });
      if (!git)
        throw new Error("could not find git repo executable in this job");
      this.executableManifest = (
        await GitUtil.getExecutableManifest(git)
      );
      
      // overwrite default singularity connector if cvmfs needs to be turned on
      if (this.executableManifest.connector === "SingCVMFSConnector"){
        this.connector = this.getSingCVMFSConnector();
      }

      // upload executable folder
      if (!this.job.localExecutableFolder)
        throw new Error("job.localExecutableFolder is required");

      Helper.nullGuard(this.job.userId);
      
      this.emitEvent("SLURM_UPLOAD_EXECUTABLE", "uploading executable folder");  // isn't this SCP?
      let uploader: BaseFolderUploader = (
        await FolderUploaderHelper.cachedUploadGit(
          localExecutableFolder,
          this.job.hpc,
          this.job.userId,
          this.connector
        )
      );
      
      this.connector.setRemoteExecutableFolderPath(uploader.hpcPath);
      this.job.remoteExecutableFolder = (await dataSource
        .getRepository(Folder)
        .findOneBy({ id: uploader.id }))!;

      // upload data folder
      if (this.job.localDataFolder) {
        this.emitEvent("SLURM_UPLOAD_DATA", "uploading data folder");
        uploader = await FolderUploaderHelper.upload(
          this.job.localDataFolder,
          this.job.hpc,
          this.job.userId,
          this.job.id,
          this.connector
        );

        this.connector.setRemoteDataFolderPath(uploader.hpcPath);
        this.job.remoteDataFolder = (await dataSource
          .getRepository(Folder)
          .findOneBy({ id: uploader.id }))!;
      } else if (this.job.remoteDataFolder) {
        this.connector.setRemoteDataFolderPath(
          this.job.remoteDataFolder.hpcPath
        );
      }

      // create empty result folder
      this.emitEvent("SLURM_CREATE_RESULT", "create result folder");
      uploader = await FolderUploaderHelper.upload(
        { type: "empty" },
        this.job.hpc,
        this.job.userId,
        this.job.id,
        this.connector
      );
      this.connector.setRemoteResultFolderPath(uploader.hpcPath);
      this.job.remoteResultFolder = (await dataSource
        .getRepository(Folder)
        .findOneBy({ id: uploader.id }))!;

      // update job
      await this.updateJob({
        remoteDataFolder: this.job.remoteDataFolder,
        remoteExecutableFolder: this.job.remoteExecutableFolder,
        remoteResultFolder: this.job.remoteResultFolder,
      });

      Helper.nullGuard(this.slurm);

      // submit job
      await this.connector.execExecutableManifestWithinImage(
        this.executableManifest,
        this.slurm
      );
      await this.connector.submit();

      this.jobOnHpc = true;
      this.emitEvent(
        "JOB_INIT",
        "job [" + this.id + "] is initialized, waiting for job completion"
      );

      // log on xsede
      Helper.nullGuard(this.hpc);
      await XSEDEUtil.jobLog(this.connector.slurm_id, this.hpc, this.job);
    } catch (e) {
      this.emitEvent(
        "JOB_RETRY",
        "job [" + this.id + "] encountered system error " + Helper.assertError(e).toString()
      );
    }
  }

  /**
   * If the job is complete, download the results to the remote result file path, and if it encounters an error, update the event log to reflect this.
   *
   * @async
   */
  async onMaintain() {
    try {
      // query HPC status via connector
      const status = await this.connector.getStatus();

      // failing condition
      if (status === "ERROR" || status === "F" || status === "NF") {
        this.emitEvent(
          "JOB_FAILED",
          "job [" + this.id + "] failed with status " + status
        );
        return;
      }

      // complete condition
      if (status === "C" || status === "CD" || status === "UNKNOWN") {
        // collect logs
        await this.connector.getSlurmStdout();
        await this.connector.getSlurmStderr();

        // update job usage
        this.emitEvent("JOB_ENDED", "job [" + this.id + "] finished");
        const usage = await this.connector.getUsage();
        await this.updateJob(usage);

        // submit again to XSEDE
        Helper.nullGuard(this.hpc);
        await XSEDEUtil.jobLog(this.connector.slurm_id, this.hpc, this.job); // for backup submit

        // fetch result folder content
        // TODO: make this shorter
        const contents = await this.connector.getRemoteResultFolderContent();

        let defaultResultFolderDownloadablePath =
          this.executableManifest.default_result_folder_downloadable_path;

        if (defaultResultFolderDownloadablePath) {
          // bring default downloadable to front (for frontend display)
          contents.sort((a, b) =>
            a === defaultResultFolderDownloadablePath ? -1 : (
              b === defaultResultFolderDownloadablePath ? 1 : 0
            )
          );
          if (!defaultResultFolderDownloadablePath.startsWith("/")) {
            defaultResultFolderDownloadablePath = `/${defaultResultFolderDownloadablePath}`;
            contents.sort((a, b) =>
              a === defaultResultFolderDownloadablePath ? -1 : (
                b === defaultResultFolderDownloadablePath ? 1 : 0
              )
            );
          }
        }

        // update redis with this job's contents
        Helper.nullGuard(this.id);
        await this.resultFolderContentManager.put(this.id, contents);
      }
    } catch (e) {
      // try to retry job if something goes wrong
      this.emitEvent(
        "JOB_RETRY",
        "job [" + this.id + "] encountered system error " + Helper.assertError(e).toString()
      );
    }
  }

  /**
   * Pause the connector
   */
  async onPause() {
    await this.connector.pause();
  }

  /**
   * Resume the connector
   */
  async onResume() {
    await this.connector.resume();
  }

  /**
   * Cancel the connector
   */
  async onCancel() {
    await this.connector.cancel();
  }
}
export default CommunityContributionMaintainer;
