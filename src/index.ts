import { ClientConfig, PubSub, Subscription } from '@google-cloud/pubsub';
import {
  Message,
  SubscriberOptions,
} from '@google-cloud/pubsub/build/src/subscriber';
import { default as Pino } from 'pino';
import { EventEmitter } from 'events';

export type WorkerConfig = {
  shutdownGracePeriod: number;
  logger?: Pino.Logger;
};

export type JobResult = void | Boolean;

export type WorkHandler = (
  payload: Buffer,
  logger: Pino.Logger
) => Promise<JobResult>;

export const WorkerEvents = {
  shutdown: 'shutdown',
  message: 'message',
  error: 'error',
  exiting: 'exiting',
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
  _totalCount = 0;
  _currentProcessing = 0;

  constructor(
    subscriptionName: string,
    handler: WorkHandler,
    clientConfig: ClientConfig = {},
    subscriberOptions: SubscriberOptions = {},
    workerConfig: WorkerConfig = { shutdownGracePeriod: 3000 }
  ) {
    super();
    this.clientConfig = clientConfig;
    this.subscriberOptions = subscriberOptions;
    this.workerConfig = workerConfig;
    this._handler = handler;

    this.subscriptionName = subscriptionName;
    this.logger = workerConfig.logger
      ? workerConfig.logger.child({ subscriptionName })
      : Pino({
          name: subscriptionName,
        });
    this._status = 'off';
  }

  async start(): Promise<Boolean> {
    try {
      process.on('SIGTERM', () => {
        this.logger.info('SIGTERM received');
        this.shutdown();
      });
      this._client = new PubSub(this.clientConfig);
      this._subscription = this._client.subscription(
        this.subscriptionName,
        this.subscriberOptions
      );
      const [meta] = await this._subscription.getMetadata();
      this.logger.info({ meta }, 'Subscription Opened');
      this._subscription.on('message', this.messageHandler);
      this._status = 'running';
      return true;
    } catch (err) {
      this.logger.error(err, 'Error getting subscription', {
        subscriptionName: this.subscriptionName,
      });
      this.emit(WorkerEvents.shutdown, {
        state: 'error',
        error: err,
        msg: 'failed to start',
        exitCode: 101,
      });
      this._status = 'error';
      return false;
    }
  }

  private async messageHandler(message: Message): Promise<void> {
    if (this._status === 'shutdown') {
      message.nack();
      return;
    }
    const logger = this.logger.child({
      messageId: message.id,
    });
    logger.info(
      {
        deliveryAttempt: message.deliveryAttempt,
      },
      'recieved message'
    );
    this.emit(WorkerEvents.message, {
      messageId: message.id,
      messageData: message.data,
    });
    this._currentProcessing += 1;
    this._totalCount += 1;
    try {
      await this._handler(message.data, logger);
      message.ack();
    } catch (err) {
      this.emit(WorkerEvents.error, {
        messageId: message.id,
        messageData: message.data,
        err: err,
      });
      message.nack();
      logger.error(err, 'Error occurred processing message');
    }
    this._currentProcessing -= 1;
    if (this._status === 'shutdown' && this._currentProcessing === 0) {
      this._completeShutdown && this._completeShutdown();
    }
  }

  shutdown(gracePeriod?: number): Promise<void> {
    this._status = 'shutdown';
    this._subscription &&
      this._subscription.removeListener('message', this.messageHandler);
    this._isShutdown = new Promise((resolve) => {
      this._completeShutdown = () => {
        this.emit(WorkerEvents.shutdown, { exitCode: 0 });
        resolve();
      };
    });
    this.emit(WorkerEvents.exiting, {
      state: 'running',
      currentlyProcessing: this._currentProcessing,
      msg: 'Shutting Down',
    });
    if (this._currentProcessing === 0) {
      this._completeShutdown && this._completeShutdown();
    }
    const timer = setTimeout(() => {
      this._completeShutdown && this._completeShutdown();
    }, gracePeriod || this.workerConfig.shutdownGracePeriod);
    this._isShutdown.then(() => {
      this.logger.warn(
        {},
        'shutdown grace period elapsed without clean shutdown.'
      );
      clearTimeout(timer);
    });
    return this._isShutdown;
  }
}
