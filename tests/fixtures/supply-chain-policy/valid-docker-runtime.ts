import { spawn } from "node:child_process";

spawn("docker", ["run", process.env.RUNTIME_IMAGE]);
