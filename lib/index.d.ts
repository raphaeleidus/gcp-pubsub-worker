/// <reference types="node" />
import { ClientConfig, PubSub, Subscription } from '@google-cloud/pubsub';
import { SubscriberOptions } from '@google-cloud/pubsub/build/src/subscriber';
import { default as Pino } from 'pino';
import { EventEmitter } from 'events';
export declare type WorkerConfig = {
    shutdownGraceperiod: number;
};
export declare type JobResult = void | Boolean;
export declare type WorkHandler = (payload: Buffer, logger: Pino.Logger) => Promise<JobResult>;
export declare const WorkerEvents: {
    shutdown: string;
    message: string;
    error: string;
    exiting: string;
};
export default class PubsubWorker extends EventEmitter {
    clientConfig: ClientConfig;
    subscriberOptions: SubscriberOptions;
    logger: Pino.Logger;
    workerConfig: WorkerConfig;
    subscriptionName: string;
    _client?: PubSub;
    _subscription?: Subscription;
    _handler: WorkHandler;
    _isShutdown?: Promise<void>;
    _completeShutdown?: () => void;
    _status: String;
    _totalCount: number;
    _currentProcessing: number;
    constructor(subscriptionName: string, handler: WorkHandler, clientConfig?: ClientConfig, subscriberOptions?: SubscriberOptions, workerConfig?: WorkerConfig);
    start(): Promise<Boolean>;
    private messageHandler;
    shutdown(gracePeriod?: number): Promise<void>;
}
