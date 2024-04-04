import {
  DataSourceOptions,
  DataSource,
} from "typeorm";
import { config } from "../configs/config";
import { Event } from "../src/models/Event";
import { Job } from "../src/models/Job";
import { Log } from "../src/models/Log";
import { Cache } from "./models/Cache";
import { Folder } from "./models/Folder";
import { Git } from "./models/Git";
import { GlobusTransferRefreshToken } from "./models/GlobusTransferRefreshToken";

const entities = [Event, Log, Job, Git, GlobusTransferRefreshToken, Folder, Cache];

let dbConfig: DataSourceOptions = {
  name: "default",
  type: "mysql",
  host: config.mysql.host,
  port: config.mysql.port,
  username: config.mysql.username,
  password: config.mysql.password,
  database: config.mysql.database,
  synchronize: true,
  logging: false,
  migrationsRun: true,
  entities: entities,
  cache: {
    type: "redis",
    options: {
      host: config.redis.host,
      port: config.redis.port,
      // TODO: add password support
    },
    ignoreErrors: true,
  },
};

if (config.is_jest) {
  dbConfig = {
    name: "default",
    type: "better-sqlite3",
    database: ":memory:",
    dropSchema: true,
    synchronize: true,
    logging: false,
    entities,
  };
}

const dataSource = new DataSource(dbConfig);

dataSource.initialize().then(() => ({})).catch((err) => {
  console.error("Error initializing the database", err);
});

export default dataSource;
