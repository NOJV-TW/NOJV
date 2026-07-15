import { spawn } from "node:child_process";

spawn("docker", ["run", "alpine:latest"]);
