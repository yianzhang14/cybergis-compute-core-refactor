
// import { Console } from "console";
const swaggerDocument: Record<string, unknown> = require(__dirname + "../../swagger.json");  // eslint-disable-line
// import bodyParser = require("body-parser");
import express = require("express");
import fileUpload = require("express-fileupload");
import morgan = require("morgan");
import swaggerUI = require("swagger-ui-express");

import {
  config,
} from "../../configs/config";
import dataSource from "../utils/DB";

import folderRouter from "./FolderRoutes";
import gitRouter from "./GitRoutes";
import infoRouter from "./InfoRoutes";
import jobRouter from "./JobRoutes";
import userRouter from "./UserRoutes";

// create the express app
const app = express();


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

// create documentation routes
app.use("/ts-docs", express.static(__dirname + "../../tsdoc"));
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
