import { FPS } from '../layout.ts';

// Records the canvas and the audio engine's output straight to a file.
//
// The first type the browser can encode wins. Recent Chrome and Safari write
// MP4 (H.264 + AAC), which YouTube, TikTok and Instagram take as is; otherwise
// it is WebM (VP9 + Opus), which YouTube takes and TikTok/Instagram want
// converted: docs/recording-and-export.md has the one ffmpeg line for that.
//
// A silent video has no sound track at all, so it gets the same types without an audio codec.
const TYPES = [
  'video/mp4;codecs=avc1.64002A,mp4a.40.2', // H.264 High@4.2: the level that covers 1080×1920 at 60 fps
  'video/mp4;codecs=avc1.4D002A,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** The type with its audio codec taken out: `video/mp4;codecs=avc1.64002A`. */
function videoOnly(type: string): string {
  return type.replace(/,(mp4a\.40\.2|opus)/, '');
}

export function pickType(audio = true): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.map((t) => (audio ? t : videoOnly(t))).find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function describeType(type: string | null): string {
  if (!type) return 'recording not supported in this browser';
  const mp4 = type.startsWith('video/mp4');
  const codec = type.includes('avc1') ? 'H.264' : type.includes('vp9') ? 'VP9' : type.includes('vp8') ? 'VP8' : '';
  const audio = type.includes('mp4a') ? 'AAC' : type.includes('opus') ? 'Opus' : '';
  return [mp4 ? 'MP4' : 'WebM', codec, audio].filter(Boolean).join(' · ');
}

export class Recorder {
  readonly type: string;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  readonly startedAt = performance.now();

  /** `audio` null records the picture alone: a file with no sound track. */
  constructor(canvas: HTMLCanvasElement, audio: MediaStream | null) {
    const type = pickType(audio !== null);
    if (!type) throw new Error('MediaRecorder cannot record video in this browser');
    this.type = type;
    const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    // 16 Mbps: what YouTube recommends uploading for 1080p60. Platforms re-encode
    // anyway; a clean master keeps fast-moving balls and thin rings free of blocks.
    this.recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000, ...(audio ? { audioBitsPerSecond: 192_000 } : {}) });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  get extension(): string {
    return this.type.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const done = () => resolve(new Blob(this.chunks, { type: this.type.split(';')[0] }));
      this.recorder.onstop = done;
      if (this.recorder.state === 'inactive') done();
      else this.recorder.stop();
      for (const track of this.recorder.stream.getTracks()) if (track.kind === 'video') track.stop();
    });
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
