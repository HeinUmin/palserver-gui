// Exercise the Docker Engine build API used by the containerized Agent.
// Builds the game runtime image only; never starts or downloads the game.
import fs from "node:fs";
import { docker } from "../packages/agent/dist/docker.js";

const context = `${process.env.PALSERVER_REPO_DIR}/images/vanilla`;
const image = "palserver/vanilla:ci-api";
const stream = await docker.buildImage({ context, src: fs.readdirSync(context) }, { t: image });
await new Promise((resolve, reject) => {
  docker.modem.followProgress(stream, (err, output) => {
    if (err) return reject(err);
    const failure = output.find((evt) => evt.error || evt.errorDetail?.message);
    if (failure) return reject(new Error(failure.errorDetail?.message || failure.error));
    resolve();
  }, (evt) => {
    if (evt.stream) process.stdout.write(evt.stream);
  });
});
await docker.getImage(image).inspect();
console.log(`Game image built and inspected through the Agent's Docker API: ${image}`);
