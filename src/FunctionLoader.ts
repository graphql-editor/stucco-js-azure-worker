import { isFunction } from 'util';

import { AzureFunctionsRpcMessages as rpc } from 'azure-functions-nodejs-worker/dist/azure-functions-language-worker-protobuf/src/rpc';
import { FunctionInfo } from 'azure-functions-nodejs-worker/dist/src/FunctionInfo';
import { InternalException } from "azure-functions-nodejs-worker/dist/src/utils/InternalException";

import { HttpRequest, Context } from 'azure-functions-nodejs-worker/dist/src/public/Interfaces';

import { getMessageType, parseMIME, MessageType, messageTypeToMime } from 'stucco-js/lib/raw/message';
import {
  fieldResolveHandler,
  interfaceResolveTypeHandler,
  scalarParseHandler,
  scalarSerializeHandler,
  setSecretsHandler,
} from 'stucco-js/lib/raw';

class UserError extends Error {}

function handleUserError(context: Context, e: Error) {
  if(e instanceof UserError) {
    context.log(e.message);
    context.res = {
      body: e.message,
      headers: {
        'content-type': 'text/plain',
      },
      status: 400,
    }
  } else {
    throw e;
  }
}

function getUserFunction(): (contentType: string, body: Buffer) => Promise<[string, Uint8Array]> {
  return async (contentType: string, body: Buffer): Promise<[string, Uint8Array]> => {
    const msgType = getMessageType(parseMIME(contentType));
    let data: Uint8Array;
    let responseMessageType: MessageType;
    switch (msgType) {
      case MessageType.FIELD_RESOLVE_REQUEST:
        data = await fieldResolveHandler(contentType, Uint8Array.from(body));
        responseMessageType = MessageType.FIELD_RESOLVE_RESPONSE
        break;
      case MessageType.INTERFACE_RESOLVE_TYPE_REQUEST:
        data = await interfaceResolveTypeHandler(contentType, Uint8Array.from(body));
        responseMessageType = MessageType.INTERFACE_RESOLVE_TYPE_RESPONSE
        break;
      case MessageType.SCALAR_PARSE_REQUEST:
        data = await scalarParseHandler(contentType, Uint8Array.from(body));
        responseMessageType = MessageType.SCALAR_PARSE_RESPONSE
        break;
      case MessageType.SCALAR_SERIALIZE_REQUEST:
        data = await scalarSerializeHandler(contentType, Uint8Array.from(body));
        responseMessageType = MessageType.SCALAR_SERIALIZE_RESPONSE;
        break;
      case MessageType.SET_SECRETS_REQUEST:
        data = await setSecretsHandler(contentType, Uint8Array.from(body));
        responseMessageType = MessageType.SET_SECRETS_RESPONSE;
        break;
      default:
        throw new UserError('invalid message type');
    }
    return [messageTypeToMime(responseMessageType), data]
  };
}

export interface IFunctionLoader {
  load(functionId: string, metadata: rpc.IRpcFunctionMetadata): void;
  getInfo(functionId: string): FunctionInfo;
  getFunc(functionId: string): (context: Context, ...inputs: any[]) => Promise<void>;
}

export class FunctionLoader implements IFunctionLoader {
  private stuccoFunc?: (contentType: string, body: Buffer) => Promise<[string, Uint8Array]>;
  private info: {
    [k: string]: FunctionInfo
  };

  constructor() {
    this.info = {};
  }

  load(functionId: string, metadata: rpc.IRpcFunctionMetadata): void {
    try {
      this.info[functionId] = new FunctionInfo(metadata);
      if (!this.stuccoFunc) {
        this.stuccoFunc = getUserFunction();
        if(!isFunction(this.stuccoFunc)) {
          throw new InternalException("The resolved entry point is not a function and cannot be invoked by the functions runtime. Make sure the function has been correctly exported.");
        }
      }
    } catch(e) {
      if(e instanceof InternalException) {
        throw e;
      }
      throw new InternalException(e.message);
    }
  }

  getInfo(functionId: string): FunctionInfo {
    if(this.info) {
      return this.info[functionId];
    } else {
      throw new InternalException(`Function info for '${functionId}' is not loaded and cannot be invoked.`);
    }
  }

  getFunc(functionId: string): (context: Context, ...inputs: any[]) => Promise<void> {
    const stuccoFunc = this.stuccoFunc;
    if (stuccoFunc) {
        return async (context:Context, req: HttpRequest): Promise<void> => {
          try {
            const rawBody: Buffer | unknown = req.rawBody
            if(!rawBody || !Buffer.isBuffer(rawBody)) {
              throw new UserError(`Body for ${functionId} is not a valid protobuf payload`);
            }
            const response = await this.stuccoFunc(req.headers['content-type'], rawBody);
            context.res = {
              body: response[1],
              headers: {
                'content-type': response[0],
              },
            }
          } catch(e) {
            handleUserError(context, e)
          }
        }
    } else {
        throw new InternalException(`Function code for '${functionId}' is not loaded and cannot be invoked.`);
    }
  }
}