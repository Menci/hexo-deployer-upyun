/*
 *  This file is part of hexo-deployer-upyun.
 *
 *  Copyright (c) 2016 Menci <huanghaorui301@gmail.com>
 *
 *  hexo-deployer-upyun is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  hexo-deployer-upyun is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with hexo-deployer-upyun. If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

let Promise = require('bluebird');
let UpYun = require('upyun');
let fs = require('fs');
Promise.promisifyAll(fs);
let path = require('path');
let md5 = require('md5');
require('colors');

hexo.extend.deployer.register('upyun', async function (args) {
  try {
    let public_dir = path.join(this.base_dir, this.config.public_dir);

    if (!args.bucket || !args.operator || !args.password || !args.endpoint || !args.secret) {
      console.log('Please check your config.');
      return;
    }

    let upyun = new UpYun(args.bucket, args.operator, args.password, args.endpoint, {
      apiVersion: 'v2',
      secret: args.secret
    });
    Promise.promisifyAll(upyun);

    // Get remote file list
    async function getRemoteList() {
      let data = await upyun.getFileAsync('.file_list.json', null);
      if (data.statusCode === 200) {
        return JSON.parse(data.data);
      } else if (data.statusCode === 404) {
        return [];
      } else throw data;
    }

    let remoteList = await getRemoteList();

    let ignoreFileRE = new RegExp(args.ignore_path_re.file);
    let ignoreDirRE = new RegExp(args.ignore_path_re.dir);
    // Get local file list
    async function getLocalList(dir) {
      let list = await fs.readdirAsync(dir), res = [];
      for (let name of list) {
        let fillPath = path.join(dir, name);
        let stats = await fs.statAsync(fillPath);
        if (stats.isFile()) {
          if (ignoreFileRE.test(fillPath)) continue;
          let content = await fs.readFileAsync(fillPath);
          let md5sum = md5(content);
          res.push({ name: name, type: 'file', md5sum: md5sum });
        } else if (stats.isDirectory()) {
          if (ignoreDirRE.test(fillPath)) continue;
          let subItems = await getLocalList(fillPath);
          res.push({ name: name, type: 'dir', subItems: subItems });
        }
      }
      return res;
    }

    let localList = await getLocalList(public_dir);

    // Get diff list
    function getDiffList(remoteList, localList) {
      let removeList = [], putList = [], removeDirList = [], mkdirList = [];

      // Determine which files to remote and put
      let remoteFiles = remoteList.filter(x => x.type === 'file');
      let localFiles = localList.filter(x => x.type === 'file');

      for (let remote of remoteFiles) {
        // For a remote file, find it in local files
        let index = localFiles.findIndex(x => x.name === remote.name),
            local = index === -1 ? null : localFiles[index];

        if (local) {
          localFiles.splice(index, 1);
          if (local.md5sum === remote.md5sum) {
            // Not modified
            continue;
          } else {
            putList.push(local.name);
          }
        } else {
          removeList.push(remote.name);
        }
      }

      // The local files that wasn't matched by a remote file should be put
      if (localFiles.length) {
        putList = putList.concat(localFiles.map(x => x.name));
      }

      // Determine what dirs to remote or make
      let remoteDirs = remoteList.filter(x => x.type === 'dir');
      let localDirs = localList.filter(x => x.type === 'dir');

      function concatSubItems(subLists, prefixPath) {
        function joinPrefixPath(list) {
          return list.map(x => path.join(prefixPath, x));
        }
        removeList = removeList.concat(joinPrefixPath(subLists.removeList));
        putList = putList.concat(joinPrefixPath(subLists.putList));
        removeDirList = removeDirList.concat(joinPrefixPath(subLists.removeDirList));
        mkdirList = mkdirList.concat(joinPrefixPath(subLists.mkdirList));
      }

      for (let remote of remoteDirs) {
        // For a remote dir, find it in local dirs
        let index = localDirs.findIndex(x => x.name === remote.name),
            local = index === -1 ? null : localDirs[index];

        if (local) {
          localDirs.splice(index, 1);
          // Get diff of files and dirs in the dir
          let subLists = getDiffList(remote.subItems, local.subItems);
          concatSubItems(subLists, remote.name);
        } else {
          // Get diff of files and dirs in the dir
          let subLists = getDiffList(remote.subItems, []);
          concatSubItems(subLists, remote.name);
          removeDirList.push(remote.name);
        }
      }

      // The local dirs that wasn't matched by a remote dir should be make and put
      if (localDirs.length) {
        for (let local of localDirs) {
          mkdirList.push(local.name);
          let subLists = getDiffList([], local.subItems);
          concatSubItems(subLists, local.name);
        }
      }

      function getDirDepth(dir) {
        return dir.split('/').length;
      }

      mkdirList.sort((a, b) => getDirDepth(a) - getDirDepth(b));
      removeDirList.sort((a, b) => getDirDepth(b) - getDirDepth(a));

      return {
        removeList: removeList,
        putList: putList,
        removeDirList: removeDirList,
        mkdirList: mkdirList
      };
    }

    let lists = getDiffList(remoteList, localList);

    // Process the lists
    async function processRemove(removeList) {
      for (let file of removeList) {
        let data = await upyun.deleteFileAsync(file);
        if (data.statusCode === 200) {
          console.log('INFO '.green + ` Removed file ${file.magenta} successfully`);
        } else if (data.statusCode === 404) {
          console.log('WARN '.yellow + ` Error removing file ${file.magenta} - 404`);
        } else throw ['processRemove', file, data];
      }
    }

    async function processRemoveDir(removeDirList) {
      // Sometimes if we remove a dir just after removing the inside files,
      // we got 'directory not empty', so let's try 5 times before throw an
      // fatel error.
      for (let dir of removeDirList) {
        let try_times = parseInt(args.try_times) || 5;
        let success = false;
        while (try_times--) {
          let data = await upyun.removeDirAsync(dir);
          if (data.statusCode === 200) {
            console.log('INFO '.green + ` Removed dir ${dir.magenta} successfully`);
            success = true;
            break;
          } else if (data.statusCode === 404) {
            console.log('WARN '.yellow + ` Error removing dir ${dir.magenta} - 404`);
            success = true;
            break;
          }
          await Promise.delay(500);
        }
        if (!success) throw ['processRemoveDir', dir, data];
      }
    }

    async function processMkdir(mkdirList) {
      for (let dir of mkdirList) {
        let data = await upyun.makeDirAsync(dir);
        if (data.statusCode === 200) {
          console.log('INFO '.green + ` Make dir ${dir.magenta} successfully`);
        } else throw ['processMkdir', dir, data];
      }
    }

    async function processPut(putList) {
      for (let file of putList) {
        let mimeType = null;
        if (path.extname(file) === '') mimeType = 'text/html';

        let fileContent = await fs.readFileAsync(path.resolve(public_dir, file));

        let data = await upyun.putFileAsync(file, fileContent, mimeType, true, null);
        if (data.statusCode === 200) {
          console.log('INFO '.green + ` Put file ${file.magenta} successfully`);
        } else throw ['processPut', file, data];
      }
    }

    async function putFileList(fileList) {
      let data = await upyun.putFileAsync('.file_list.json', Buffer.from(JSON.stringify(fileList)), 'application/json', true, null);
      if (data.statusCode === 200) {
        console.log('INFO '.green + ' Put new file list successfully');
      } else throw ['putFileList', data];
    }

    await processRemove(lists.removeList);
    await processRemoveDir(lists.removeDirList);
    await processMkdir(lists.mkdirList);
    await processPut(lists.putList);
    await putFileList(localList);
  } catch (e) {
    console.log('ERROR'.red + ' The error message is below');
    console.log(e);
  }
});
