import db from '../database/db.js';
import { logger } from '../utils/logger.js';
import { shell } from '../utils/shell.js';
import path from 'path';
import Docker from 'dockerode';
import { ensureDirectoryExists } from '../utils/utils.js';

import fastq from 'fastq';

const queue = fastq.promise(handleBackup, 1);

const docker = new Docker();

const config = await db.select('*').from('configurations').first();

if (!config) {
  logger('No configurations found in database. Please run `capdb config` first.');
  process.exit(1);
}

const backupDirectory = path.join(config.capdb_config_folder_path, 'backups');

ensureDirectoryExists(backupDirectory);

process.on('message', async (containerId) => {
  queue.push(containerId)
});

async function handleBackup(containerId) {
  ensureDirectoryExists(backupDirectory);
  try {
    const currentDate = new Date().toLocaleString();
    const filePath = await backupDatabase(containerId, backupDirectory);

    if (filePath) {
      const absoluteBackupFilePath = path.join(backupDirectory, filePath);
      await updateContainerStatus(containerId, true, currentDate, absoluteBackupFilePath);
      logger(`Successfully backed up container ID: ${containerId}`);
    } else {
      await updateContainerStatus(containerId, false, currentDate, null);
      logger(`Backup failed for container ID: ${containerId}`);
    }
  } catch (error) {
    logger(`Error in backup job for container ID: ${containerId}, ${error.message}`);
  }
}

async function backupDatabase(containerId) {
  ensureDirectoryExists(backupDirectory);

  let fileName = '';
  const currentDateISOString = new Date().toISOString().replace(/:/g, '-');

  try {
    logger(`Fetching container info from database`);
    const container = await db.select('*').from('containers').where({ id: containerId }).first();
    const dockerContainers = await docker.listContainers({ all: true });

    const containerExists = dockerContainers.some((c) =>
      c.Names.includes(`/${container.container_name}`),
    );

    if (!containerExists) {
      logger(`Container ${container.container_name} does not exist.`);
      return null;
    }

    logger(`Starting database backup for ${container.container_name}`);
    switch (container.database_type) {
      case 'postgres':
        process.env.PGPASSWORD = container.database_password;
        fileName = `dump-${container.container_name}-${container.database_name}-${currentDateISOString}.sql`;
        // prettier-ignore
        await shell(`docker exec -i ${container.container_name} pg_dump -U ${container.database_username} -d ${container.database_name} > ${path.join(backupDirectory, fileName)}`);
        delete process.env.PGPASSWORD;
        break;

      case 'mongodb':
        fileName = `dump-${container.container_name}-${container.database_name}-${currentDateISOString}`;
        // prettier-ignore
        await shell(`docker exec -i ${container.container_name} mongodump --username ${container.database_username} --password ${container.database_password} --db ${container.database_name} --out ${path.join(backupDirectory, fileName)}`);
        break;

      default:
        logger(`Unsupported database type: ${container.database_type}`);
        return null;
    }

    return fileName;
  } catch (error) {
    logger(`Error during backup: ${error?.message}`);
    return null;
  }
}

async function updateContainerStatus(containerId, status, lastBackedUpAt, lastBackedUpFile) {
  ensureDirectoryExists(backupDirectory);
  try {
    logger(`Updating container status in database`);

    const updatedContainer = await db('containers').where('id', containerId).update({
      status: status,
      last_backed_up_at: lastBackedUpAt,
      last_backed_up_file: lastBackedUpFile,
    });

   await db('backups').insert({
      container_id: containerId,
      file_name: lastBackedUpFile.split('\\').pop().split('/').pop(),
      file_path: lastBackedUpFile,
    });

    if (updatedContainer === 1) {
      return true;
    } else {
      logger(`Failed to update container with ID ${containerId}`);
      return false;
    }
  } catch (error) {
    logger(`Error updating container with ID ${containerId}: ${error.message}`);
    return false;
  }
}
