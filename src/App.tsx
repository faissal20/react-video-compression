import { useState, useRef } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import { FFprobeWorker } from "ffprobe-wasm";


function App() {
  const [loaded, setLoaded] = useState(false);
  const ffmpegRef = useRef(new FFmpeg());
  const [meta, setMeta] = useState<any>(null);
  const [result_meta, setResultMeta] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const messageRef = useRef<HTMLParagraphElement | null>(null)
  const worker = new FFprobeWorker();


  const load = async () => {
    const baseURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
    });

    ffmpeg.on("progress", ({ progress, time }) => {
      console.log(progress, time);
    })
    // toBlobURL is used to bypass CORS issue, urls with the same
    // domain can be used directly.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `/ffmpeg-core.wasm`,
        "application/wasm"
      ),
      workerURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.worker.js`,
        "text/javascript"
      ),
    });
    setLoaded(true);
  };


  // to make sure all the videos could be compressed and converted to mp4 we need to :
  // 1 separate the video and audio
  // 2 then split the video into parts.
  // 3 split the audio into parts.
  // 4 compress the video parts.
  // 5 compress the audio parts.
  // 6 concat the video and audio parts.
  // 7 concat the video parts.
  // 8 concat the audio parts.
  // 9 delete all the parts.
  // 10 delete the video and audio parts.
  // 11 delete the video and audio.
  // 12 delete the parts directory.


  function separateVideoAndAudio(input: string, extension: string) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.exec([
      "-i",
      input,
      "-c:v",
      "copy",
      "-an",
      `output-video.${extension}`,
      "-c:a",
      "copy",
      "output-audio.aac",
    ]);
  }

  function splitVideo(input: string, output_fromat: string, extension: string, duration: number) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.exec([
      "-i",
      input,
      "-f",
      "segment",
      "-segment_time",
      duration.toString(),
      "-c",
      "copy",
      output_fromat + '.' + extension,
    ]);
  }

  function splitAudio(input: string, output_fromat: string, extension: string = 'aac', duration: number) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.exec([
      "-i",
      input,
      "-f",
      "segment",
      "-segment_time",
      duration.toString(),
      "-c",
      "copy",
      output_fromat + '.' + extension,
    ]);
  }

  function compressVideo(input: string, output: string) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.exec([
      "-i",
      input,
      "-c:v",
      "libx264",
      "-crf",
      "30",
      output,
    ]);
  }

  function compressAudio(input: string,output: string) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.exec([
      "-i",
      input,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      output,
    ]);
  }

  function concatVideoParts(parts: string, output: string) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.writeFile('parts.txt', parts);
    ffmpeg.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "parts.txt",
      "-c",
      "copy",
      output,
    ]);
  }

  function concatAudioParts(parts: string[], output: string) {
  }


  function concatVideoAndAudio(video: string, audio: string) {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.exec([
      "-i",
      video,
      "-i",
      audio,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "output.mp4",
    ]);
  }


  async function getMetaData(file = null, data: Uint8Array | null = null) {

    if (file) return await worker.getFileInfo(file);
    if (!data) return null;

    const result = new File([data.buffer], 'output.mp4', { type: 'video/mp4' });
    return await worker.getFileInfo(result);

  }



  const getData = () => {
    return async (e: any) => {

      const file = e.target.files[0];

      const ffmpeg = ffmpegRef.current;

      let meta_data = await getMetaData(file)

      setMeta(meta_data);

      if (!meta_data) return;

      let blobUrl = URL.createObjectURL(file);


      await ffmpeg.writeFile(file.name, await fetchFile(blobUrl));

      const video = file.name;
      const input_ext = meta_data.format.filename.split('.').pop() || 'mp4';

      separateVideoAndAudio(video, input_ext);

      let dir = await ffmpeg.listDir('/');
      console.log(dir);

      // create parts directory 
      // await ffmpeg.createDir('parts');
      await ffmpeg.createDir('parts_audio');
      await ffmpeg.createDir('parts_video');

      dir = await ffmpeg.listDir('/');
      console.log(dir);


      splitVideo(`output-video.${input_ext}`, 'parts_video/video_part_%d', input_ext, 1);
      splitAudio('output-audio.aac', 'parts_audio/audio_part_%d', 'aac', 1);


      let video_part_dir = await ffmpeg.listDir('parts_video');
      let audio_part_dir = await ffmpeg.listDir('parts_audio');
      console.log(video_part_dir, audio_part_dir);


      
      await ffmpeg.createDir('compressed_parts_audio');
      await ffmpeg.createDir('compressed_parts_video');


      for (let i = 0; i < video_part_dir.length; i++) {
        if (video_part_dir[i].isDir) continue;
        console.log(video_part_dir[i].name);
        compressVideo(`/parts_video/${video_part_dir[i].name}`, `compressed_parts_video/part-${i - 2}.mp4`);
      }

      for (let i = 0; i < audio_part_dir.length; i++) {
        if (audio_part_dir[i].isDir) continue;
        console.log(audio_part_dir[i].name);
        compressAudio(`/parts_audio/${audio_part_dir[i].name}`, `compressed_parts_audio/part-${i -2}.aac`);
      }

      console.log('done compressing');

      dir = await ffmpeg.listDir('/');
      console.log(dir);

      video_part_dir = await ffmpeg.listDir('compressed_parts_audio');
      audio_part_dir = await ffmpeg.listDir('compressed_parts_video');
      console.log(video_part_dir, audio_part_dir);


      let video_parts : string = '';
      for (let i = 0; i < video_part_dir.length; i++) {
        if (video_part_dir[i].isDir) continue;
        video_parts += `file '/compressed_parts_video/part-${i - 2}.mp4'\n`;
      }

      await ffmpeg.writeFile('video_parts.txt', video_parts);

      let audio_parts : string = '';

      for (let i = 0; i < audio_part_dir.length; i++) {
        if (audio_part_dir[i].isDir) continue;
        audio_parts += `file '/compressed_parts_audio/part-${i - 2}.aac'\n`;
      }

      await ffmpeg.writeFile('audio_parts.txt', audio_parts);

      await ffmpeg.exec(["-f", "concat", "-safe", "0", "-y", "-i", `video_parts.txt`, "-c", "copy", "output-compressed.mp4"]);

      await ffmpeg.exec(["-f", "concat", "-safe", "0", "-y", "-i", `audio_parts.txt`, "-c", "copy", "output-compressed.aac"]);
      
      dir = await ffmpeg.listDir('/');
      console.log(dir);

      //merge the video and audio

      await ffmpeg.exec(["-i", "output-compressed.mp4", "-i", "output-compressed.aac", "-c:v", "copy", "-c:a", "copy", "output.mp4"]);

      
      const result_data = await ffmpeg.readFile('output.mp4');
      const array_data = new Uint8Array(result_data as ArrayBuffer);

      if (videoRef.current) {
        videoRef.current.src = URL.createObjectURL(
          new Blob([array_data.buffer], { type: 'video/mp4' })
        )
      }


      setResultMeta(getMetaData(null, array_data));


      // clear all the files
      console.log('clearing all the files');
      console.log('deleting video ');
      await ffmpeg.deleteFile(video);
      console.log('deleting output');
      await ffmpeg.deleteFile('output.mp4');
      
      console.log('deleting video_parts.txt');
      await ffmpeg.deleteFile('video_parts.txt');
      console.log('deleting audio_parts.txt');
      await ffmpeg.deleteFile('audio_parts.txt');

      let compressed_parts_audio = await ffmpeg.listDir('compressed_parts_audio');
      
      console.log(compressed_parts_audio);

      for (let i = 0; i < compressed_parts_audio.length; i++) {
        if (compressed_parts_audio[i].isDir) continue;
        console.log(compressed_parts_audio[i].name);
        await ffmpeg.deleteFile(`/compressed_parts_audio/part-${i - 2}.aac`);
      }

      let compressed_parts_video = await ffmpeg.listDir('compressed_parts_video');
      console.log(compressed_parts_video);

      for (let i = 0; i < compressed_parts_video.length; i++) {
        if (compressed_parts_video[i].isDir) continue;
        console.log(compressed_parts_video[i].name);
        await ffmpeg.deleteFile(`/compressed_parts_video/part-${i - 2}.mp4`);
      }

      console.log('deleting compressed_parts_audio');
      await ffmpeg.deleteDir('compressed_parts_audio');
      console.log('deleting compressed_parts_video');
      await ffmpeg.deleteDir('compressed_parts_video');

      let parts_audio = await ffmpeg.listDir('parts_audio');
      let parts_video = await ffmpeg.listDir('parts_video');
      
      for (let i = 0; i < parts_audio.length; i++) {
        if (parts_audio[i].isDir) continue;
        console.log('deleting parts_audio');
        await ffmpeg.deleteFile(`/parts_audio/${parts_audio[i].name}`);
      }

      for (let i = 0; i < parts_video.length; i++) {
        if (parts_video[i].isDir) continue;
        console.log('deleting parts_video');
        await ffmpeg.deleteFile(`/parts_video/${parts_video[i].name}`);
      }


      console.log('deleting parts_audio');
      await ffmpeg.deleteDir('parts_audio');
      console.log('deleting parts_video');
      await ffmpeg.deleteDir('parts_video');

      console.log('deleting output-compressed.mp4');
      await ffmpeg.deleteFile('output-compressed.mp4');
      console.log('deleting output-compressed.aac');
      await ffmpeg.deleteFile('output-compressed.aac');

      console.log('delete output-video.mp4');
      await ffmpeg.deleteFile('output-video.mp4');
      console.log('delete output-audio.aac');
      await ffmpeg.deleteFile('output-audio.aac');

      
      console.log('done deleting all the files');




      dir = await ffmpeg.listDir('/');
      console.log(dir);

      return;

     
    }
  }

  return loaded ? (
    <div style={
      {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px'
      }
    }>
      <video ref={videoRef} width={250} height={250} controls></video>
      <br />

      <br />

      <p ref={messageRef}></p>

      <input type="file" onChange={getData()} />

      {
        meta && (
          <div style={
            {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              width: '100%'
            }
          }>
            <h6>general info</h6>
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(meta.format).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{JSON.stringify(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h6>streams</h6>
            {
              meta.streams.map((stream: any, index: number) => (
                <div key={index}>
                  <h6>stream {index + 1}</h6>
                  <table>
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(stream).map(([key, value]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td style={{ wordBreak: 'break-all' }}
                          >{JSON.stringify(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))

            }
          </div>
        )
      }


      {
        result_meta && (
          <div style={
            {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              width: '100%'
            }
          }>
            <h6>general info</h6>
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(meta.format).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{JSON.stringify(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h6>streams</h6>
            {
              meta.streams.map((stream: any, index: number) => (
                <div key={index}>
                  <h6>stream {index + 1}</h6>
                  <table>
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(stream).map(([key, value]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td style={{ wordBreak: 'break-all' }}
                          >{JSON.stringify(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))

            }
          </div>
        )
      }
    </div>
  ) : (
    <button onClick={load}>Load ffmpeg-core</button>
  );
}

export default App;
