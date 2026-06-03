export declare class QueueWorker {
    private readonly connection;
    private readonly worker;
    private readonly apiClient;
    constructor();
    start(): Promise<void>;
    private processJob;
    stop(): Promise<void>;
}
