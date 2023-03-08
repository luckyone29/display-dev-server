'use strict';

const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver')
const sharp = require('sharp');

module.exports = class OptimizeBundleToFilesizePlugin {
  constructor(options) {
    this.options = options;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise('OptimizeBundleToFilesizePlugin', async compilation => {
      const {outputPath, filename, maxFileSize, lowestQuality} = this.options;
      const srcDir = compilation.compiler.outputPath;

      await (async function optimizeToSize(srcDir, outputPath, filename, maxFileSize, quality = 100) {
        if (quality <= lowestQuality) quality = lowestQuality;
        // console.log(`creating bundle with ${quality} quality level...`)

        const zippedBundle = await new Promise(async resolve => {
          const output = fs.createWriteStream(path.resolve(outputPath, filename));
          output.on("close", () => resolve({
            filename: path.resolve(outputPath, filename),
            files: optimizedResult
          }));
          const archive = archiver("zip", {zlib: {level: 9}});
          archive.pipe(output);

          const inputFiles = fs.readdirSync(path.resolve(srcDir))

          const optimizedResult = await Promise.all(inputFiles.map(async file => {
            return new Promise(async resolve => {
              const result = await (async () => {
                if (['.jpg', '.png'].includes(path.extname(file))) {
                  const content = await fs.promises.readFile(path.resolve(srcDir, file));
                  const optimizedContentBuffer = path.extname(file) === '.jpg' ?
                    await sharp(content).jpeg({quality}).toBuffer() :
                    await sharp(content).png({quality, effort: 10}).toBuffer();

                  archive.append(optimizedContentBuffer, {name: file});
                  return {
                    name: file,
                    buffer: optimizedContentBuffer,
                  }

                } else {
                  archive.file(path.resolve(srcDir, file), {name: file})
                  return {name: file};
                }
              })();
              resolve(result);
            })
          }))
          archive.finalize();
        })

        const zippedBundleSize = fs.statSync(zippedBundle.filename).size;

        if (zippedBundleSize < maxFileSize || quality <= lowestQuality) {
          await Promise.all(zippedBundle.files.filter(file => file.buffer).map(file => {
            return new Promise(async resolve => {
              await fs.promises.writeFile(path.resolve(srcDir, file.name), file.buffer);
              resolve();
            })
          }))

          return zippedBundle.filename;

        } else {
          await optimizeToSize(srcDir, outputPath, filename, maxFileSize, quality -= 5)
        }

      })(srcDir, outputPath, filename, maxFileSize, 100);
    });
  }
};