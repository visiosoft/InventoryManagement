import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const run = promisify(execFile);

/**
 * A still frame from a video, for the WhatsApp bubble a sales video actually
 * arrives as.
 *
 * WhatsApp's own video attachment tops out at 16 MB — well under what a real
 * sales video runs to — so the video is hosted on our own server and the
 * message that goes out is an image: this frame, with a link to watch the
 * rest. This is that frame.
 *
 * Tried at one second in, which avoids the black or fading-in first frame a
 * clip very often opens on. A clip shorter than a second — or one ffmpeg
 * otherwise can't seek into — falls back to frame zero rather than failing
 * the whole upload over a thumbnail. Driven as a direct ffmpeg process
 * rather than through a wrapper library: a wrapper's screenshot helper can
 * silently produce nothing for a short clip with no error to catch, which a
 * plain command and a check that the file actually landed cannot do.
 */
export async function makeVideoThumbnail(videoPath, outPath) {
  const attempts = ['00:00:01', '00:00:00'];
  let lastErr = null;
  for (const timestamp of attempts) {
    try {
      await run(ffmpegPath, [
        '-y', '-ss', timestamp, '-i', videoPath,
        '-frames:v', '1', '-vf', 'scale=640:-1',
        outPath,
      ], { maxBuffer: 16 * 1024 * 1024 });
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return outPath;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not extract a thumbnail from this video');
}
