declare module "@copilotkit/runtime" {
  export class CopilotRuntime {
    constructor(options?: any);
  }
  export class OpenAIAdapter {
    constructor(options?: any);
  }
  export class ExperimentalEmptyAdapter {
    constructor(options?: any);
  }
  export function copilotRuntimeNextJSAppRouterEndpoint(options: any): {
    handleRequest: (req: any) => Promise<Response>;
  };
}
