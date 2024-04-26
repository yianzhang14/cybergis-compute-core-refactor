import express = require("express");
// import { Console } from "console";
const swaggerDocument: Record<string, unknown> = require("../production/swagger.json");  // eslint-disable-line
// import bodyParser = require("body-parser");
import { Request, NextFunction, Response } from "express";
import fileUpload = require("express-fileupload");
import jsonschema = require("jsonschema");
import morgan = require("morgan");
import swaggerUI = require("swagger-ui-express");
import {
  config,
} from "./configs/config";
import folderRouter from "./FolderRouter";
import gitRouter from "./GitRoutes";
import infoRouter from "./InfoRoutes";
import jobRouter from "./JobRoutes";
import dataSource from "./src/DB";
import JupyterHub from "./src/JupyterHub";
import { Folder } from "./src/models/Folder";
import { Git } from "./src/models/Git";
import { ResultFolderContentManager, GlobusTaskListManager } from "./src/Redis";
import { SSHCredentialGuard } from "./src/SSHCredentialGuard";
import Statistic from "./src/Statistic";
import Supervisor from "./src/Supervisor";
import type {
  authReqBody,
  updateFolderBody,
} from "./src/types";
import userRouter from "./UserRoutes";

// establish database connection
dataSource
  .initialize()
  .then(() => {
    console.log("Data Source has been initialized!");
  })
  .catch((err) => {
    console.error("Error during Data Source initialization:", err);
    throw err;
  });

// create the express app
const app = express();

// handle parsing arguments
// app.use(bodyParser.json());  // possibly unneeded now with newer versions of express
app.use(express.json());
app.use(morgan("combined"));
app.use(express.urlencoded({ extended: true }));
// app.use(bodyParser.urlencoded({ extended: true }));

// uploading files
app.use(
  fileUpload({
    limits: { fileSize: config.local_file_system.limit_in_mb * 1024 * 1024 },
    useTempFiles: true,
    abortOnLimit: true,
    tempFileDir: config.local_file_system.cache_path,
    safeFileNames: true,
    limitHandler: (req, res, _next) => {
      res.json({ error: "file too large" });
      res.status(402);
    },
  })
);

// global object instantiation
export const supervisor = new Supervisor();
export const validator = new jsonschema.Validator();
export const sshCredentialGuard = new SSHCredentialGuard();
export const resultFolderContent = new ResultFolderContentManager();
export const jupyterHub = new JupyterHub();
export const statistic = new Statistic();
export const globusTaskList = new GlobusTaskListManager();

// object for vadidating API calls
export const schemas = {
  user: {
    type: "object",
    properties: {
      jupyterhubApiToken: { type: "string" },
    },
    required: ["jupyterhubApiToken"],
  },
  cancel: {
    type: "object",
    properties: {
      jupyterhubApiToken: { type: "string" },
      jobId: { type: "string" },
    },
    required: ["jupyterhubApiToken", "jobId"],
  },
  updateFolder: {
    type: "object",
    properties: {
      jupyterhubApiToken: { type: "string" },
      name: { type: "string" },
      isWritable: { type: "boolean" },
    },
    required: ["jupyterhubApiToken"],
  },
  updateJob: {
    type: "object",
    properties: {
      jupyterhubApiToken: { type: "string" },
      param: { type: "object" },
      env: { type: "object" },
      slurm: { type: "object" },
      localExecutableFolder: { type: "object" },
      localDataFolder: { type: "object" },
      remoteDataFolder: { type: "string" },
      remoteExecutableFolder: { type: "string" },
    },
    required: ["jupyterhubApiToken"],
  },
  createJob: {
    type: "object",
    properties: {
      jupyterhubApiToken: { type: "string" },
      maintainer: { type: "string" },
      hpc: { type: "string" },
      user: { type: "string" },
      password: { type: "string" },
    },
    required: ["jupyterhubApiToken"],
  },
  initGlobusDownload: {
    type: "object",
    properties: {
      jobId: { type: "string" },
      jupyterhubApiToken: { type: "string" },
      toEndpoint: { type: "string" },
      toPath: { type: "string" },
      fromPath: { type: "string" },
    },
    required: ["jupyterhubApiToken", "toEndpoint", "toPath"],
  },
  refreshCache: {
    type: "object",
    properties: {
      hpc: { type: "string" },
    }
  }
};

// handler for route errors
export function requestErrors(v: jsonschema.ValidatorResult): string[] {
  if (v.valid) return [];

  const errors: string[] = [];
  for (const error of v.errors) errors.push(error.message);

  return errors;
}

// function to take data and get it into dictionary format for DB interfacing
export async function prepareDataForDB(
  data: Record<string, unknown>, 
  properties: string[]
): Promise<Record<string, string | Folder>> {
  const out: Record<string, string | Folder> = {};

  for (const property of properties) {
    if (data[property]) {
      if (
        property === "remoteExecutableFolder" ||
        property === "remoteDataFolder"
      ) {
        const folder: Folder | null = await (dataSource.
          getRepository(Folder).
          findOneBy({
            id: data[property] as string
          })
        );

        if (!folder) throw new Error("could not find " + property);

        out[property] = folder;
      } else {
        out[property] = data[property as keyof updateFolderBody] as string;
      }
    }
  }

  return out;
}

// initializes a hello world repository in the DB
async function initHelloWorldGit() {
  await dataSource.initialize();
  
  const helloWorldGit = await dataSource
    .getRepository(Git)
    .findOneBy({
      id: "hello_world"
    });

  if (helloWorldGit === null) {
    const git = {
      id: "hello_world",
      address: "https://github.com/cybergis/cybergis-compute-hello-world.git",
      isApproved: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await dataSource.getRepository(Git).save(git);
  }
}

// call initialization stuff
void initHelloWorldGit();

export const authMiddleWare = async (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  const body = req.body as authReqBody;
  
  // if there is an api token in the body
  if (body.jupyterhubApiToken) {
    try {
      // try to extract username/host and store into local variables
      res.locals.username = await jupyterHub.getUsername(
        body.jupyterhubApiToken
      );
      res.locals.host = jupyterHub.getHost(body.jupyterhubApiToken);
    } catch {}

    // continue onto the actual route
    next();
  // if there isn't, just give a 402 error
  } else {
    res.status(402).json(
      { error: "Malformed input. No jupyterhub api token passed with request." }
    );
  }
};

// create documentation routes
app.use("/ts-docs", express.static("production/tsdoc"));
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerDocument));

/**
 * @openapi
 * /:
 *  get:
 *      description: Get "hello world" from the route directory (Authentication NOT REQUIRED)
 *      responses:
 *          200:
 *              descrption: Successfuly returns "hello world"
 *
 */
app.get("/", (req, res) => {
  res.json({ message: "hello world" });
});


/**
   * @openapi
   * /clean:
   *  put:
   *      description: Not yet implemented
   */
app.put("/clean", async function (_req, _res) { });  // eslint-disable-line

app.use("/folder", folderRouter);
app.use("/git", gitRouter);
app.use("/", infoRouter);
app.use("/job", jobRouter);
app.use("/user", userRouter);

app.listen(config.server_port, config.server_ip, () =>
  console.log(
    "supervisor server is up, listening to port: " + config.server_port
  )
);
