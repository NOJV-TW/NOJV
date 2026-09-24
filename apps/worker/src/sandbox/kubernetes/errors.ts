export class SandboxBackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxBackpressureError";
  }
}

export class SandboxAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxAdmissionError";
  }
}

export class SandboxInfeasibleError extends SandboxAdmissionError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxInfeasibleError";
  }
}

export class SandboxImagePullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxImagePullError";
  }
}

export class SandboxInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxInfrastructureError";
  }
}

export class SandboxTransientInfrastructureError extends SandboxInfrastructureError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxTransientInfrastructureError";
  }
}

export class SandboxCleanupError extends SandboxInfrastructureError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxCleanupError";
  }
}
