import { spawn } from "child_process";

import { config } from "../../configs/config";


/**
 * Helper class for interfacing with python scripts in the ./python directory. Primarily deals with globus.
 */
export default class PythonUtil {

  /**
   * Runs the specified python file. The person running this file can provide user input.
   *
   * @static
   * @async
   * @param {string} file - Path of the file to run
   * @param {string[]} args - Arguments to be passed when running the file.
   * @param {string[]} returnTags - Items to be returned
   * @returns {Promise<Record<string, unknown>>} - Values returned by the function that correspond the the ones passed in returnTags
   */
  static async runInteractive(
    file: string,
    args: string[] = [],
    returnTags: string[] = []
  ): Promise<Record<string, unknown>> {
    args.unshift(`${__dirname}/python/${file}`);
    const child = spawn("python3", args);
    const out: Record<string, unknown> = {};

    child.stdout.on("data", function (result: any) {  // eslint-disable-line @typescript-eslint/no-explicit-any
      let stdout = Buffer.from(result, "utf-8").toString();  // eslint-disable-line @typescript-eslint/no-unsafe-argument
      const parsedStdout = stdout.split("@");

      for (const o of parsedStdout) {
        for (const tag of returnTags) {
          const regex = new RegExp(`${tag}=((?!\]).)*`, "g"); //eslint-disable-line
          const m = o.match(regex);
          if (m) {
            m.forEach((v, _i) => {
              v = v.replace(`${tag}=[`, "");
              out[tag] = v;
            });
            stdout = stdout.replace("@", "");
            stdout = stdout.replace(regex, "");
            stdout = stdout.replace("]", "");
          }
        }
      }
    });

    process.stdin.on("readable", () => {
      const chunk = process.stdin.read();  // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      if (chunk !== null) child.stdin.write(chunk);
    });

    return new Promise((resolve, _reject) => {
      child.on("exit", () => {
        resolve(out);
      });
      child.on("error", () => {
        resolve(out);
      });
      child.on("close", () => {
        resolve(out);
      });
    });
  }

  /**
   * Runs the specified python file.
   *
   * @static
   * @async
   * @param {string} file - Path of the file to run
   * @param {string[]} args - Arguments to be passed when running the file.
   * @param {string[]} returnTags - Items to be returned
   * @returns {Promise<Record<string, string | null>>} - Values returned by the function that correspond the the ones passed in returnTags
   */
  static async run(
    file: string,
    args: string[] = [],
    returnTags: string[] = []
  ): Promise<Record<string, string | null>> {
    args.unshift(`${__dirname}/python/${file}`);
    const child = spawn("python3", args);

    const out: Record<string, null | string> = {
      error: null as null | string,
    };

    child.stderr.on("data", function (result) {
      const stderr = Buffer.from(result, "utf-8").toString();  // eslint-disable-line @typescript-eslint/no-unsafe-argument
      if (config.is_testing) console.log(stderr);
      if (!out.error) out.error = stderr;
      else out.error += stderr;
    });

    child.stdout.on("data", function (result) {
      let stdout = Buffer.from(result, "utf-8").toString();  // eslint-disable-line @typescript-eslint/no-unsafe-argument
      const parsedStdout = stdout.split("@");

      for (const o of parsedStdout) {
        for (const tag of returnTags) {
          const regex = new RegExp(`${tag}=((?!\]).)*`, "g"); // eslint-disable-line
          const m = o.match(regex);
          if (m) {
            m.forEach((v, _i) => {
              v = v.replace(`${tag}=[`, "");
              out[tag] = v;
            });
            stdout = stdout.replace("@", "");
            stdout = stdout.replace(regex, "");
            stdout = stdout.replace("]", "");
          }
        }
      }

      if (config.is_testing) console.log(stdout);
    });

    if (config.is_testing) {
      child.stderr.on("data", function (result) {
        console.log(Buffer.from(result, "utf-8").toString());  // eslint-disable-line @typescript-eslint/no-unsafe-argument
      });
    }

    return new Promise((resolve, reject) => {
      child.on("exit", () => {
        resolve(out);
      });
      child.on("error", (err) => {
        reject(err);
      });
      child.on("close", () => {
        resolve(out);
      });
    });
  }
}
