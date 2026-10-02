/**
 * Simple JSON file-based data manager
 */

const fs = require('fs').promises;
const path = require('path');

class DataManager {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.ensureDataDir();
  }

  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  getFilePath(type) {
    return path.join(this.dataDir, `${type}.json`);
  }

  async read(type) {
    try {
      const filePath = this.getFilePath(type);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is invalid, return empty array
      return [];
    }
  }

  async write(type, data) {
    try {
      const filePath = this.getFilePath(type);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`Error writing ${type} data:`, error);
      return false;
    }
  }

  async add(type, item) {
    const data = await this.read(type);
    
    // Generate ID if not provided
    if (!item.id) {
      const maxId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) : 0;
      item.id = maxId + 1;
    }
    
    data.push(item);
    await this.write(type, data);
    return item.id;
  }

  async update(type, id, updates) {
    const data = await this.read(type);
    const index = data.findIndex(item => item.id === id);
    
    if (index !== -1) {
      data[index] = { ...data[index], ...updates };
      await this.write(type, data);
      return data[index];
    }
    return null;
  }

  async remove(type, id) {
    const data = await this.read(type);
    const filtered = data.filter(item => item.id !== id);
    
    if (filtered.length !== data.length) {
      await this.write(type, filtered);
      return true;
    }
    return false;
  }

  async find(type, filter = {}) {
    const data = await this.read(type);
    
    if (Object.keys(filter).length === 0) {
      return data;
    }
    
    return data.filter(item => {
      return Object.entries(filter).every(([key, value]) => {
        return item[key] === value;
      });
    });
  }
}

module.exports = DataManager;