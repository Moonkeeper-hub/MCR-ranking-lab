import type { PlayerInput, ResultInput } from "./engine/types";

export type RatingWorkerJob =
  | { kind: "mcr"; config: unknown; overrides: unknown; evaluationDate: string }
  | { kind: "rr"; config: unknown; overrides: unknown; evaluationDate: string }
  | { kind: "mcr-history"; config: unknown; overrides: unknown; initialMode: string }
  | { kind: "rr-history"; config: unknown; overrides: unknown };

interface QueueItem<T = unknown> {
  id: number;
  job: RatingWorkerJob;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface WorkerReply {
  type: "result" | "error";
  id: number;
  value?: unknown;
  message?: string;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  queue: QueueItem[];
  active: QueueItem | null;
}

/**
 * Fixed two-worker pool. Each worker owns its own FIFO queue; a new job is sent
 * to the shorter queue. The rating algorithms themselves remain unchanged.
 */
export class RatingWorkerPool {
  private slots: WorkerSlot[];
  private nextId = 1;
  private datasetRevision = -1;

  constructor() {
    this.slots = this.createSlots();
  }

  private createSlots(): WorkerSlot[] {
    return [0, 1].map(() => {
      const worker = new Worker(new URL("./workers/rating.worker.ts", import.meta.url), { type: "module" });
      const slot: WorkerSlot = { worker, busy: false, queue: [], active: null };
      worker.onmessage = (event: MessageEvent<WorkerReply>) => this.handleReply(slot, event.data);
      worker.onerror = (event) => {
        const active = slot.active;
        if (active) active.reject(new Error(event.message || "Rating worker error"));
        slot.active = null;
        slot.busy = false;
        this.dispatch(slot);
      };
      return slot;
    });
  }

  setDataset(players: PlayerInput[], results: ResultInput[], revision: number): void {
    if (revision === this.datasetRevision) return;
    if (this.datasetRevision >= 0) {
      // A dataset replacement invalidates queued work. Recreate both workers so
      // no job from the previous CSV pair can run against the new arrays.
      for (const slot of this.slots) {
        slot.active?.reject(new Error("Dataset changed"));
        slot.queue.forEach((item) => item.reject(new Error("Dataset changed")));
        slot.worker.terminate();
      }
      this.slots = this.createSlots();
    }
    this.datasetRevision = revision;
    for (const slot of this.slots) {
      // Browser structured-clones the dataset once per worker. Subsequent jobs
      // send only method/config data, not the CSV-derived arrays again.
      slot.worker.postMessage({ type: "init", revision, players, results });
    }
  }

  run<T>(job: RatingWorkerJob): Promise<T> {
    const slot = this.slots.reduce((best, candidate) => {
      const bestLoad = best.queue.length + (best.busy ? 1 : 0);
      const candidateLoad = candidate.queue.length + (candidate.busy ? 1 : 0);
      return candidateLoad < bestLoad ? candidate : best;
    });

    return new Promise<T>((resolve, reject) => {
      slot.queue.push({ id: this.nextId++, job, resolve: resolve as (value: unknown) => void, reject });
      this.dispatch(slot);
    });
  }

  private dispatch(slot: WorkerSlot): void {
    if (slot.busy) return;
    const item = slot.queue.shift();
    if (!item) return;
    slot.busy = true;
    slot.active = item;
    slot.worker.postMessage({ type: "job", id: item.id, revision: this.datasetRevision, job: item.job });
  }

  private handleReply(slot: WorkerSlot, reply: WorkerReply): void {
    const active = slot.active;
    if (!active || active.id !== reply.id) return;
    slot.active = null;
    slot.busy = false;
    if (reply.type === "result") active.resolve(reply.value);
    else active.reject(new Error(reply.message || "Rating worker calculation failed"));
    this.dispatch(slot);
  }
}
