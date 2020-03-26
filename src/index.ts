import loadJsonFile from "load-json-file";
import Bottleneck from "bottleneck";
import rp from "request-promise-native";
import yargs from "yargs";
import { config } from "dotenv";
import createDebug from "debug";
import allSettled from "promise.allsettled";

const debug = createDebug("bioreference");
config();

//TODO: command line settable...
const limiter = new Bottleneck({
  maxConcurrent: 20,
  reservoir: 100,
  reservoirIncreaseAmount: 100,
  reservoirIncreaseInterval: 6000 * 1000, // release 100 every 1 minute
  trackDoneStatus: true
});

interface PasswordResetUser {
  email: string;
}

async function reset(email: string, connection: string) {
  debug("Sending password reset for %s", email);

  return new Promise<void>((resolve, reject) => {
    rp({
      uri: `https://${process.env.AUTH0_DOMAIN}/dbconnections/change_password`,
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email,
        connection
      })
    })
      .then(resolve)
      .catch(() => reject(email));
  });
}

async function startResetProcess(users: PasswordResetUser[]) {
  const summaryTimer = setInterval(async () => {
    debug("Process summary: %o", await limiter.counts());
  }, 5000);

  const jobs = users.map(u =>
    limiter.schedule<void, string, string>(
      {
        id: u.email
      },
      reset,
      u.email,
      process.env.AUTH0_CONNECTION as string
    )
  );

  const results = await Promise.allSettled(jobs);
  const rejected = results.filter(res => res.status === "rejected");

  console.log(`\n###### Summary #######
              ${results.length} requests completed.
              ${rejected.length} requests failed. `);

  clearInterval(summaryTimer);
}

async function main(file: string) {
  debug("Starting password resets from %s ...", file);

  const users = await loadJsonFile<PasswordResetUser[]>(file);

  debug("Loaded %d users ...", users.length);

  await startResetProcess(users);
}

const options = yargs.usage("Usage: -f <filePath>").option("f", {
  alias: "file",
  describe: "Imported users JSON file",
  type: "string",
  demandOption: true
}).argv;

main(options.f);
