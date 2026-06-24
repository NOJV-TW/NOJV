import { configureDomainOrchestration } from "@nojv/application";
import { buildDomainOrchestrationAdapter } from "@nojv/temporal";

configureDomainOrchestration(buildDomainOrchestrationAdapter());
