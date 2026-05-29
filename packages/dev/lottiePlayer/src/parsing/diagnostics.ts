/**
 * Collects unsupported-feature diagnostics during a single animation parse.
 * Standalone so layer features can record diagnostics without a callback into the parser.
 */
export class ParseDiagnostics {
    private readonly _messages: string[] = [];
    private readonly _seen = new Set<string>(); // Dedup guard so spammy per-property warnings only surface once.

    /**
     * Records an unsupported-feature diagnostic.
     * @param message The message to record.
     */
    public push(message: string): void {
        this._messages.push(message);
    }

    /**
     * Records an unsupported-feature diagnostic only the first time the message is seen this parse.
     * Used for warnings that would otherwise be repeated for every property/layer matching the same case.
     * @param message The message to record, used as the dedup key.
     */
    public pushOnce(message: string): void {
        if (this._seen.has(message)) {
            return;
        }
        this._seen.add(message);
        this._messages.push(message);
    }

    /**
     * All diagnostics recorded during the parse, in the order they were reported.
     */
    public get messages(): readonly string[] {
        return this._messages;
    }
}
