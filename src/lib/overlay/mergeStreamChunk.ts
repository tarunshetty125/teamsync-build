export function mergeStreamChunk(existingText: string, incomingChunk: string): string {
    if (!incomingChunk) return existingText;
    if (!existingText) return incomingChunk;

    if (incomingChunk === existingText) {
        return existingText;
    }

    // Some providers emit the full accumulated response instead of a delta.
    if (incomingChunk.startsWith(existingText)) {
        return incomingChunk;
    }

    // Occasionally the same chunk is replayed verbatim.
    if (existingText.endsWith(incomingChunk)) {
        return existingText;
    }

    const maxOverlap = Math.min(existingText.length, incomingChunk.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        if (existingText.slice(-overlap) === incomingChunk.slice(0, overlap)) {
            return existingText + incomingChunk.slice(overlap);
        }
    }

    return existingText + incomingChunk;
}
