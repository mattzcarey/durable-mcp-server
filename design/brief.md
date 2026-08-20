# Project Brief

## Context

Tasks are a cool extension (see https://modelcontextprotocol.io/extensions/tasks/overview). research them and the github here (see https://github.com/modelcontextprotocol/ext-tasks). They allow long running non blocking tools on mcp servers. 

They are generally a pain to implement cause mcp servers are now stateless after the latest spec. tasks need a workflow exectuion engine and routing through to the storage on the task polling methods. 

We can build a workflow execution engine with durable objects as shown here. We should vendor the bits we need here and credit in readme (https://github.com/avenceslau/durability/tree/main/packages/durability). These should give us durable state + atleast once execution with alarms. We will work ontop of this implementation and make it our own but this is a great start.

## Package

durable-mcp-server is free on npm. we can make a package which exports McpServer class. It should be just additive of the base mcpserver class from the modelcontext protocol v2 sdk. It has the addition of server.registerTask()

It should optimise for a lovely dev experience. so tasks should feel native to the mcp server. 

eg:

import {McpServer } from "durable-mcp-server"

const createServer = () => {
const server = McpServer()

 server.registerTask(
    "task_name",
    {
    inputSchema
    },
    async (input, step) => {
      // Durable workflow
      step.do("step-1" () => {})
      step.sleep()
    },
  );

}


### Examples

we should have an example of how devs will actually use this in a real project in this repo in examples/
we will practise example driven development. so I will give feedback on wexamples and you will modify the code. 
examples will be all tested with integration tests (https://developers.cloudflare.com/workers/testing/test-harness/) run real workers project. 

tech stack is always typecript, oxfmt, oxlint. use latest wrangler. 

### Package Structure. 

I think we will need 3 layers.

Durable Object provided by the package.

```typescript
export { TaskRunner } from "durable-mcp-server";
export const TaskExecutor = createTaskEntrypoint(createServer);
export default createMcpHandler(createServer);
````

TaskExecutor - WorkerEntrypoint = stable callback execution address

DurableStep - RpcTarget = ephemeral capability for one execution lease

TaskRunner - SQLite + alarms = durable state

We can use RpcTarget for functions we wanna send over the wire. (capnweb is awesome). The TaskRunner will be a standardised DurableObject everyone has to export. but I think we will need an executor worker entrypoint that is built fro mthe createServer function. 

## Notes

Durable object networking is potentially unreliable. whenever we call an rpc method on a DO we need to add retries. this is a good implementation (https://github.com/lambrospetrou/durable-utils/blob/main/src/retries.ts)

When looking at external libs. ask me before including them. when I have shown you external implementation we should vendor our own fversion of the package. we should just take the code we need and credit in the readme. we should not use packages via npm that I have not explictly stated to use. eg. mcp sdk, agents, vite, react, vitest, oxfmt, oxlint. and there might be more but pls ask and add to this list. 