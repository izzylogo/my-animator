/**
 * HOOK FOR THE FUTURE AI FEATURE (not used yet).
 *
 * The plan: you draw stick-figure keyframes and label them with a character's name
 * (RasterKey.label). An "in-between provider" receives those keys and returns finished
 * drawings for the frames in between, drawn as that character. The app inserts them as
 * keyframes marked origin: 'generated', so they can be told apart, redone or deleted.
 *
 * Any AI service (local model or online API) can be plugged in by writing one object
 * that matches InbetweenProvider and calling registerInbetweenProvider().
 */

export interface KeyDrawing {
  frame: number;
  image: Blob; // PNG of the stick-figure keyframe
}

export interface InbetweenRequest {
  characterName: string;
  layerId: string;
  width: number;
  height: number;
  keys: KeyDrawing[]; // the drawn keyframes, in time order
  framesToFill: number[]; // frame numbers that need a drawing
}

export interface GeneratedFrame {
  frame: number;
  image: Blob;
}

export interface InbetweenProvider {
  id: string;
  name: string;
  generate(request: InbetweenRequest, onProgress?: (done: number, total: number) => void): Promise<GeneratedFrame[]>;
}

const providers = new Map<string, InbetweenProvider>();

export function registerInbetweenProvider(provider: InbetweenProvider): void {
  providers.set(provider.id, provider);
}

export function listInbetweenProviders(): InbetweenProvider[] {
  return [...providers.values()];
}
