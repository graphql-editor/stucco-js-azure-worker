import { AzureFunctionsRpcMessages as rpc } from 'azure-functions-nodejs-worker/dist/azure-functions-language-worker-protobuf/src/rpc';
import LogLevel = rpc.RpcLog.Level;
import LogCategory = rpc.RpcLog.RpcLogCategory;
import { FunctionInfo } from "azure-functions-nodejs-worker/dist/src/FunctionInfo";
import {
    LogCallback,
    ResultCallback,
    Dict,
    DoneCallback
} from 'azure-functions-nodejs-worker/dist/src/Context';
import { 
    Context,
    ExecutionContext,
    TraceContext,
    BindingDefinition,
    Logger
} from 'azure-functions-nodejs-worker/dist/src/public/Interfaces';
import { RequestProperties, Request } from 'azure-functions-nodejs-worker/dist/src/http/Request';
import { Response } from 'azure-functions-nodejs-worker/dist/src/http/Response';
import { 
    convertKeysToCamelCase,
    fromRpcTraceContext,
    getNormalizedBindingData,
    getBindingDefinitions
} from 'azure-functions-nodejs-worker/dist/src/converters';
import { HttpMethod } from 'azure-functions-nodejs-worker/dist/src/public/Interfaces';
import { fromTypedData } from 'azure-functions-nodejs-worker/dist/src/converters/RpcConverters';

/**
 * Converts 'IRpcHttp' input from the RPC layer to a JavaScript object.
 * @param rpcHttp RPC layer representation of an HTTP request
 */
function fromRpcHttp(rpcHttp: rpc.IRpcHttp): RequestProperties {
    const httpContext: RequestProperties = {
        method: <HttpMethod>rpcHttp.method,
        url: <string>rpcHttp.url,
        originalUrl: <string>rpcHttp.url,
        headers: <Dict<string>>rpcHttp.headers,
        query: <Dict<string>>rpcHttp.query,
        params: <Dict<string>>rpcHttp.params,
        body: fromTypedData(<rpc.ITypedData>rpcHttp.body),
        rawBody: fromRpcHttpBody(<rpc.ITypedData>rpcHttp.body),
    };

    return httpContext;
}

/**
 * Converts the provided body from the RPC layer to the appropriate javascript object.
 * Body of type 'byte' is a special case and it's converted to it's utf-8 string representation.
 * This is to avoid breaking changes in v2.
 * @param body The body from the RPC layer.
 */
function fromRpcHttpBody(body: rpc.ITypedData) {
    if (body && body.bytes) {
        return Buffer.from(body.bytes);
    }
    else {
        return fromTypedData(body, false);
    }
}

export function CreateContextAndInputs(info: FunctionInfo, request: rpc.IInvocationRequest, logCallback: LogCallback, callback: ResultCallback, v1WorkerBehavior: boolean) {
    let context = new InvocationContext(info, request, logCallback, callback);

    let bindings: Dict<any> = {};
    let inputs: any[] = [];
    let httpInput: RequestProperties | undefined;
    for (let binding of <rpc.IParameterBinding[]>request.inputData) {
        if (binding.data && binding.name) {
            let input;
            if (binding.data && binding.data.http) {
                input = httpInput = fromRpcHttp(binding.data.http);
            } else {
                // TODO: Don't hard code fix for camelCase https://github.com/Azure/azure-functions-nodejs-worker/issues/188
                if (!v1WorkerBehavior && info.getTimerTriggerName() === binding.name) {
                    // v2 worker converts timer trigger object to camelCase
                    input = convertKeysToCamelCase(binding)["data"];
                } else {
                    input = fromTypedData(binding.data);
                }
            }
            bindings[binding.name] = input;
            inputs.push(input);
        }
    }

    context.bindings = bindings;
    if (httpInput) {
        context.req = new Request(httpInput);
        context.res = new Response(context.done);
    }
    return {
        context: <Context>context,
        inputs: inputs
    }
}

export class InvocationContext implements Context {
    invocationId: string;
    executionContext: ExecutionContext;
    bindings: Dict<any>;
    bindingData: Dict<any>;
    traceContext: TraceContext;
    bindingDefinitions: BindingDefinition[];
    log: Logger;
    req?: Request;
    res?: Response;
    done: DoneCallback;

    constructor(info: FunctionInfo, request: rpc.IInvocationRequest, logCallback: LogCallback, callback: ResultCallback) {
        this.invocationId = <string>request.invocationId;
        this.traceContext = fromRpcTraceContext(request.traceContext);
        const executionContext = {
            invocationId: this.invocationId,
            functionName: <string>info.name,
            functionDirectory: <string>info.directory
        };
        this.executionContext = executionContext;
        this.bindings = {};
        let _done = false;
        let _promise = false;

        // Log message that is tied to function invocation
        this.log = Object.assign(
            <ILog>(...args: any[]) => logWithAsyncCheck(_done, logCallback, LogLevel.Information, executionContext, ...args),
            {
                error: <ILog>(...args: any[]) => logWithAsyncCheck(_done, logCallback, LogLevel.Error, executionContext, ...args),
                warn: <ILog>(...args: any[]) => logWithAsyncCheck(_done, logCallback, LogLevel.Warning, executionContext, ...args),
                info: <ILog>(...args: any[]) => logWithAsyncCheck(_done, logCallback, LogLevel.Information, executionContext, ...args),
                verbose: <ILog>(...args: any[]) => logWithAsyncCheck(_done, logCallback, LogLevel.Trace, executionContext, ...args)
            }
        );

        this.bindingData = getNormalizedBindingData(request);
        this.bindingDefinitions = getBindingDefinitions(info);

        // isPromise is a hidden parameter that we set to true in the event of a returned promise
        this.done = (err?: any, result?: any, isPromise?: boolean) => {
            _promise = isPromise === true;
            if (_done) {
                if (_promise) {
                    logCallback(LogLevel.Error, LogCategory.User, "Error: Choose either to return a promise or call 'done'.  Do not use both in your script.");
                } else {
                    logCallback(LogLevel.Error, LogCategory.User, "Error: 'done' has already been called. Please check your script for extraneous calls to 'done'.");
                }
                return;
            }
            _done = true;

            // Allow HTTP response from context.res if HTTP response is not defined from the context.bindings object
            if (info.httpOutputName && this.res && this.bindings[info.httpOutputName] === undefined) {
                this.bindings[info.httpOutputName] = this.res;
            }

            callback(err, {
                return: result,
                bindings: this.bindings
            });
        };
    }
}

// Emit warning if trying to log after function execution is done.
function logWithAsyncCheck(done: boolean, log: LogCallback, level: LogLevel, executionContext: ExecutionContext, ...args: any[]) {
    if (done) {
        let badAsyncMsg = "Warning: Unexpected call to 'log' on the context object after function execution has completed. Please check for asynchronous calls that are not awaited or calls to 'done' made before function execution completes. ";
        badAsyncMsg += `Function name: ${executionContext.functionName}. Invocation Id: ${executionContext.invocationId}. `;
        badAsyncMsg += `Learn more: https://go.microsoft.com/fwlink/?linkid=2097909 `;
        log(LogLevel.Warning, LogCategory.System, badAsyncMsg);
    }
    return log(level, LogCategory.User, ...args);
}