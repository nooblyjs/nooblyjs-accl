/**
 * @fileoverview Resource Management Module
 *
 * Handles all resource management operations including:
 * - Staff Management and Task Assignment
 * - Equipment Management and Tracking
 * - Warehouse Space Management
 * - Performance Analytics
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

class ResourceModule {
  constructor(services, eventEmitter) {
    this.services = services;
    this.eventEmitter = eventEmitter;
    this.logger = services.logger;
    this.dataServe = services.dataServe;
    this.cache = services.cache;
    this.queue = services.queue;
    this.measuring = services.measuring;
  }

  // =================== STAFF MANAGEMENT ===================

  /**
   * Create a new staff member
   * @param {Object} staffData - Staff member data
   * @returns {Promise<string>} Staff UUID
   */
  async createStaffMember(staffData) {
    try {
      const staff = {
        id: staffData.id || uuidv4(),
        employeeId: staffData.employeeId,
        name: staffData.name,
        role: staffData.role, // picker, packer, receiver, supervisor, forklift_operator
        department: staffData.department || 'warehouse',
        shift: staffData.shift, // morning, afternoon, night
        skills: staffData.skills || [], // picking, packing, receiving, quality_control, forklift
        certifications: staffData.certifications || [],
        status: staffData.status || 'active', // active, inactive, on_break, off_shift
        currentLocation: staffData.currentLocation || null,
        currentTask: null,
        performance: {
          tasksCompleted: 0,
          averageTaskTime: 0,
          qualityScore: 100,
          attendance: 100
        },
        contactInfo: {
          email: staffData.email,
          phone: staffData.phone,
          emergencyContact: staffData.emergencyContact
        },
        startDate: staffData.startDate || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const staffId = await this.dataServe.add('staff', staff);

      // Cache staff data for quick access
      await this.cache.put(`staff:${staff.employeeId}`, staff);

      this.eventEmitter.emit('staff.created', { staffId, staff });
      this.logger.info(`Staff member created: ${staff.name} (${staff.employeeId})`);

      return staffId;
    } catch (error) {
      this.logger.error('Error creating staff member:', error);
      throw new Error(`Failed to create staff member: ${error.message}`);
    }
  }

  /**
   * Assign task to staff member
   * @param {string} employeeId - Employee ID
   * @param {Object} taskData - Task assignment data
   * @returns {Promise<Object>} Assignment result
   */
  async assignTaskToStaff(employeeId, taskData) {
    try {
      // Get staff member
      const staffMembers = await this.dataServe.jsonFind('staff', {
        predicate: `obj.employeeId === '${employeeId}' && obj.status === 'active'`
      });

      if (staffMembers.length === 0) {
        throw new Error(`Active staff member not found: ${employeeId}`);
      }

      const staff = staffMembers[0];

      // Validate task requirements against staff skills
      if (taskData.requiredSkills && taskData.requiredSkills.length > 0) {
        const hasRequiredSkills = taskData.requiredSkills.every(skill =>
          staff.skills.includes(skill)
        );

        if (!hasRequiredSkills) {
          throw new Error(`Staff member lacks required skills: ${taskData.requiredSkills.join(', ')}`);
        }
      }

      // Create task assignment
      const assignment = {
        id: uuidv4(),
        taskId: taskData.taskId,
        taskType: taskData.taskType,
        employeeId,
        staffName: staff.name,
        assignedAt: new Date().toISOString(),
        estimatedDuration: taskData.estimatedDuration || 30,
        priority: taskData.priority || 'normal',
        status: 'assigned', // assigned, in_progress, completed, cancelled
        location: taskData.location || null,
        instructions: taskData.instructions || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const assignmentId = await this.dataServe.add('task_assignments', assignment);

      // Update staff current task
      const updatedStaff = {
        ...staff,
        currentTask: {
          assignmentId,
          taskId: taskData.taskId,
          taskType: taskData.taskType,
          assignedAt: assignment.assignedAt,
          status: 'assigned'
        },
        currentLocation: taskData.location || staff.currentLocation,
        updatedAt: new Date().toISOString()
      };

      // Find and update staff
      const allStaff = await this.dataServe.list('staff');
      const staffEntry = allStaff.find(entry => entry.data.employeeId === employeeId);
      if (staffEntry) {
        await this.dataServe.add('staff', updatedStaff, staffEntry.id);
      }

      // Update cache
      await this.cache.put(`staff:${employeeId}`, updatedStaff);

      this.eventEmitter.emit('task.assigned', { assignmentId, assignment, staff: updatedStaff });
      this.logger.info(`Task assigned: ${taskData.taskType} to ${staff.name} (${employeeId})`);

      return assignment;
    } catch (error) {
      this.logger.error('Error assigning task to staff:', error);
      throw new Error(`Failed to assign task: ${error.message}`);
    }
  }

  /**
   * Complete task assignment
   * @param {string} assignmentId - Assignment ID
   * @param {Object} completionData - Task completion data
   * @returns {Promise<Object>} Completion result
   */
  async completeTaskAssignment(assignmentId, completionData) {
    try {
      // Get assignment details
      const assignments = await this.dataServe.jsonFind('task_assignments', {
        predicate: `obj.id === '${assignmentId}'`
      });

      if (assignments.length === 0) {
        throw new Error(`Task assignment not found: ${assignmentId}`);
      }

      const assignment = assignments[0];

      // Calculate actual duration
      const startTime = new Date(assignment.assignedAt);
      const endTime = new Date();
      const actualDuration = Math.round((endTime - startTime) / (1000 * 60)); // minutes

      // Update assignment
      const updatedAssignment = {
        ...assignment,
        status: 'completed',
        completedAt: endTime.toISOString(),
        actualDuration,
        quality: completionData.quality || 'good', // excellent, good, fair, poor
        notes: completionData.notes || '',
        updatedAt: new Date().toISOString()
      };

      // Find and update assignment
      const allAssignments = await this.dataServe.list('task_assignments');
      const assignmentEntry = allAssignments.find(entry => entry.data.id === assignmentId);
      if (assignmentEntry) {
        await this.dataServe.add('task_assignments', updatedAssignment, assignmentEntry.id);
      }

      // Update staff performance and clear current task
      await this.updateStaffPerformance(assignment.employeeId, {
        taskCompleted: true,
        actualTime: actualDuration,
        estimatedTime: assignment.estimatedDuration,
        quality: completionData.quality
      });

      // Record performance metrics
      await this.measuring.increment('tasks_completed');
      await this.measuring.record('task_duration', actualDuration);
      await this.measuring.record('task_efficiency',
        (assignment.estimatedDuration / actualDuration) * 100);

      this.eventEmitter.emit('task.completed', {
        assignmentId,
        assignment: updatedAssignment,
        performance: {
          actualDuration,
          efficiency: (assignment.estimatedDuration / actualDuration) * 100
        }
      });

      this.logger.info(`Task completed: ${assignment.taskType} by ${assignment.staffName} in ${actualDuration} min`);

      return updatedAssignment;
    } catch (error) {
      this.logger.error('Error completing task assignment:', error);
      throw new Error(`Failed to complete task assignment: ${error.message}`);
    }
  }

  /**
   * Update staff performance metrics
   * @param {string} employeeId - Employee ID
   * @param {Object} performanceData - Performance data
   * @returns {Promise<void>}
   */
  async updateStaffPerformance(employeeId, performanceData) {
    try {
      const staffMembers = await this.dataServe.jsonFind('staff', {
        predicate: `obj.employeeId === '${employeeId}'`
      });

      if (staffMembers.length === 0) return;

      const staff = staffMembers[0];
      const currentPerf = staff.performance;

      let updatedPerformance = { ...currentPerf };

      if (performanceData.taskCompleted) {
        updatedPerformance.tasksCompleted += 1;

        // Update average task time
        const totalTime = currentPerf.averageTaskTime * (currentPerf.tasksCompleted - 1) + performanceData.actualTime;
        updatedPerformance.averageTaskTime = Math.round(totalTime / updatedPerformance.tasksCompleted);

        // Update quality score
        const qualityScores = { excellent: 100, good: 90, fair: 70, poor: 50 };
        const newQualityScore = qualityScores[performanceData.quality] || 90;
        updatedPerformance.qualityScore = Math.round(
          (currentPerf.qualityScore * 0.9) + (newQualityScore * 0.1)
        );
      }

      const updatedStaff = {
        ...staff,
        performance: updatedPerformance,
        currentTask: null, // Clear current task
        updatedAt: new Date().toISOString()
      };

      // Find and update staff
      const allStaff = await this.dataServe.list('staff');
      const staffEntry = allStaff.find(entry => entry.data.employeeId === employeeId);
      if (staffEntry) {
        await this.dataServe.add('staff', updatedStaff, staffEntry.id);
      }

      // Update cache
      await this.cache.put(`staff:${employeeId}`, updatedStaff);

      this.eventEmitter.emit('staff.performance.updated', { employeeId, performance: updatedPerformance });
    } catch (error) {
      this.logger.error('Error updating staff performance:', error);
      throw error;
    }
  }

  /**
   * Get available staff for task type
   * @param {string} taskType - Type of task
   * @param {Array} requiredSkills - Required skills
   * @returns {Promise<Array>} Available staff members
   */
  async getAvailableStaff(taskType, requiredSkills = []) {
    try {
      let predicate = `obj.status === 'active' && obj.currentTask === null`;

      // Filter by required skills
      if (requiredSkills.length > 0) {
        const skillChecks = requiredSkills.map(skill => `obj.skills.includes('${skill}')`);
        predicate += ` && (${skillChecks.join(' && ')})`;
      }

      const availableStaff = await this.dataServe.jsonFind('staff', { predicate });

      // Sort by performance and availability
      const scoredStaff = availableStaff.map(staff => {
        let score = 0;
        score += staff.performance.qualityScore * 0.4;
        score += (1 / (staff.performance.averageTaskTime || 30)) * 100 * 0.3;
        score += staff.performance.tasksCompleted * 0.3;
        return { ...staff, availabilityScore: score };
      });

      scoredStaff.sort((a, b) => b.availabilityScore - a.availabilityScore);

      return scoredStaff;
    } catch (error) {
      this.logger.error('Error getting available staff:', error);
      throw new Error(`Failed to get available staff: ${error.message}`);
    }
  }

  // =================== EQUIPMENT MANAGEMENT ===================

  /**
   * Create new equipment
   * @param {Object} equipmentData - Equipment data
   * @returns {Promise<string>} Equipment UUID
   */
  async createEquipment(equipmentData) {
    try {
      const equipment = {
        id: equipmentData.id || uuidv4(),
        assetId: equipmentData.assetId,
        name: equipmentData.name,
        type: equipmentData.type, // forklift, pallet_jack, scanner, printer, conveyor
        model: equipmentData.model,
        manufacturer: equipmentData.manufacturer,
        serialNumber: equipmentData.serialNumber,
        status: equipmentData.status || 'available', // available, in_use, maintenance, out_of_service
        location: equipmentData.location || 'equipment_bay',
        assignedTo: null,
        specifications: equipmentData.specifications || {},
        maintenance: {
          lastService: equipmentData.lastService || null,
          nextService: equipmentData.nextService || null,
          serviceInterval: equipmentData.serviceInterval || 30, // days
          totalHours: 0,
          serviceHistory: []
        },
        usage: {
          totalTasks: 0,
          averageTaskTime: 0,
          utilizationRate: 0
        },
        purchaseDate: equipmentData.purchaseDate,
        warranty: equipmentData.warranty || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const equipmentId = await this.dataServe.add('equipment', equipment);

      this.eventEmitter.emit('equipment.created', { equipmentId, equipment });
      this.logger.info(`Equipment created: ${equipment.name} (${equipment.assetId})`);

      return equipmentId;
    } catch (error) {
      this.logger.error('Error creating equipment:', error);
      throw new Error(`Failed to create equipment: ${error.message}`);
    }
  }

  /**
   * Assign equipment to staff member
   * @param {string} assetId - Equipment asset ID
   * @param {string} employeeId - Employee ID
   * @param {Object} assignmentData - Assignment details
   * @returns {Promise<Object>} Assignment result
   */
  async assignEquipment(assetId, employeeId, assignmentData) {
    try {
      // Get equipment
      const equipmentList = await this.dataServe.jsonFind('equipment', {
        predicate: `obj.assetId === '${assetId}' && obj.status === 'available'`
      });

      if (equipmentList.length === 0) {
        throw new Error(`Available equipment not found: ${assetId}`);
      }

      const equipment = equipmentList[0];

      // Get staff member
      const staffMembers = await this.dataServe.jsonFind('staff', {
        predicate: `obj.employeeId === '${employeeId}' && obj.status === 'active'`
      });

      if (staffMembers.length === 0) {
        throw new Error(`Active staff member not found: ${employeeId}`);
      }

      const staff = staffMembers[0];

      // Create equipment assignment
      const assignment = {
        id: uuidv4(),
        assetId,
        employeeId,
        staffName: staff.name,
        assignedAt: new Date().toISOString(),
        expectedReturn: assignmentData.expectedReturn || null,
        purpose: assignmentData.purpose || 'general_use',
        status: 'assigned', // assigned, in_use, returned
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const assignmentId = await this.dataServe.add('equipment_assignments', assignment);

      // Update equipment status
      const updatedEquipment = {
        ...equipment,
        status: 'in_use',
        assignedTo: employeeId,
        assignmentId,
        updatedAt: new Date().toISOString()
      };

      // Find and update equipment
      const allEquipment = await this.dataServe.list('equipment');
      const equipmentEntry = allEquipment.find(entry => entry.data.assetId === assetId);
      if (equipmentEntry) {
        await this.dataServe.add('equipment', updatedEquipment, equipmentEntry.id);
      }

      this.eventEmitter.emit('equipment.assigned', { assignmentId, assignment, equipment: updatedEquipment });
      this.logger.info(`Equipment assigned: ${equipment.name} to ${staff.name}`);

      return assignment;
    } catch (error) {
      this.logger.error('Error assigning equipment:', error);
      throw new Error(`Failed to assign equipment: ${error.message}`);
    }
  }

  /**
   * Return equipment from staff member
   * @param {string} assignmentId - Assignment ID
   * @param {Object} returnData - Return details
   * @returns {Promise<Object>} Return result
   */
  async returnEquipment(assignmentId, returnData) {
    try {
      // Get assignment
      const assignments = await this.dataServe.jsonFind('equipment_assignments', {
        predicate: `obj.id === '${assignmentId}' && obj.status === 'assigned'`
      });

      if (assignments.length === 0) {
        throw new Error(`Equipment assignment not found: ${assignmentId}`);
      }

      const assignment = assignments[0];

      // Update assignment
      const updatedAssignment = {
        ...assignment,
        status: 'returned',
        returnedAt: new Date().toISOString(),
        condition: returnData.condition || 'good',
        notes: returnData.notes || '',
        updatedAt: new Date().toISOString()
      };

      // Find and update assignment
      const allAssignments = await this.dataServe.list('equipment_assignments');
      const assignmentEntry = allAssignments.find(entry => entry.data.id === assignmentId);
      if (assignmentEntry) {
        await this.dataServe.add('equipment_assignments', updatedAssignment, assignmentEntry.id);
      }

      // Update equipment status
      const equipmentList = await this.dataServe.jsonFind('equipment', {
        predicate: `obj.assetId === '${assignment.assetId}'`
      });

      if (equipmentList.length > 0) {
        const equipment = equipmentList[0];
        const usageTime = new Date() - new Date(assignment.assignedAt);
        const usageHours = Math.round(usageTime / (1000 * 60 * 60 * 100)) / 10; // decimal hours

        const updatedEquipment = {
          ...equipment,
          status: returnData.condition === 'damaged' ? 'maintenance' : 'available',
          assignedTo: null,
          assignmentId: null,
          maintenance: {
            ...equipment.maintenance,
            totalHours: equipment.maintenance.totalHours + usageHours
          },
          updatedAt: new Date().toISOString()
        };

        // Find and update equipment
        const allEquipment = await this.dataServe.list('equipment');
        const equipmentEntry = allEquipment.find(entry => entry.data.assetId === assignment.assetId);
        if (equipmentEntry) {
          await this.dataServe.add('equipment', updatedEquipment, equipmentEntry.id);
        }

        // Schedule maintenance if needed
        if (returnData.condition === 'damaged' ||
            updatedEquipment.maintenance.totalHours >= (equipment.maintenance.serviceInterval * 24)) {
          await this.scheduleMaintenance(assignment.assetId, {
            reason: returnData.condition === 'damaged' ? 'damage_repair' : 'scheduled_service',
            priority: returnData.condition === 'damaged' ? 'high' : 'normal'
          });
        }
      }

      this.eventEmitter.emit('equipment.returned', { assignmentId, assignment: updatedAssignment });
      this.logger.info(`Equipment returned: ${assignment.assetId} from ${assignment.staffName}`);

      return updatedAssignment;
    } catch (error) {
      this.logger.error('Error returning equipment:', error);
      throw new Error(`Failed to return equipment: ${error.message}`);
    }
  }

  /**
   * Schedule equipment maintenance
   * @param {string} assetId - Equipment asset ID
   * @param {Object} maintenanceData - Maintenance details
   * @returns {Promise<string>} Maintenance order UUID
   */
  async scheduleMaintenance(assetId, maintenanceData) {
    try {
      const maintenanceOrder = {
        id: uuidv4(),
        assetId,
        type: maintenanceData.type || 'preventive', // preventive, corrective, emergency
        reason: maintenanceData.reason,
        priority: maintenanceData.priority || 'normal',
        scheduledDate: maintenanceData.scheduledDate || new Date().toISOString(),
        estimatedDuration: maintenanceData.estimatedDuration || 120, // minutes
        assignedTechnician: maintenanceData.assignedTechnician || null,
        status: 'scheduled', // scheduled, in_progress, completed, cancelled
        description: maintenanceData.description || '',
        partsRequired: maintenanceData.partsRequired || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const maintenanceId = await this.dataServe.add('maintenance_orders', maintenanceOrder);

      // Queue maintenance task
      await this.queue.push('maintenance_queue', {
        maintenanceId,
        type: 'equipment_maintenance',
        priority: maintenanceData.priority,
        assetId
      });

      this.eventEmitter.emit('maintenance.scheduled', { maintenanceId, maintenanceOrder });
      this.logger.info(`Maintenance scheduled: ${assetId} - ${maintenanceData.reason}`);

      return maintenanceId;
    } catch (error) {
      this.logger.error('Error scheduling maintenance:', error);
      throw new Error(`Failed to schedule maintenance: ${error.message}`);
    }
  }

  // =================== PERFORMANCE ANALYTICS ===================

  /**
   * Generate staff performance report
   * @param {Object} filters - Report filters
   * @returns {Promise<Object>} Performance report
   */
  async generateStaffPerformanceReport(filters = {}) {
    try {
      let predicate = 'obj.status === "active"';

      if (filters.department) {
        predicate += ` && obj.department === '${filters.department}'`;
      }

      if (filters.role) {
        predicate += ` && obj.role === '${filters.role}'`;
      }

      const staff = await this.dataServe.jsonFind('staff', { predicate });

      const report = {
        generatedAt: new Date().toISOString(),
        filters,
        summary: {
          totalStaff: staff.length,
          averageTasksCompleted: 0,
          averageTaskTime: 0,
          averageQualityScore: 0,
          topPerformers: [],
          improvementNeeded: []
        },
        staffDetails: []
      };

      // Calculate aggregates
      let totalTasks = 0;
      let totalTime = 0;
      let totalQuality = 0;

      for (const member of staff) {
        const perf = member.performance;
        totalTasks += perf.tasksCompleted;
        totalTime += perf.averageTaskTime;
        totalQuality += perf.qualityScore;

        report.staffDetails.push({
          employeeId: member.employeeId,
          name: member.name,
          role: member.role,
          tasksCompleted: perf.tasksCompleted,
          averageTaskTime: perf.averageTaskTime,
          qualityScore: perf.qualityScore,
          efficiency: perf.averageTaskTime > 0 ? (30 / perf.averageTaskTime) * 100 : 0 // baseline 30 min
        });
      }

      if (staff.length > 0) {
        report.summary.averageTasksCompleted = Math.round(totalTasks / staff.length);
        report.summary.averageTaskTime = Math.round(totalTime / staff.length);
        report.summary.averageQualityScore = Math.round(totalQuality / staff.length);
      }

      // Identify top performers (top 20%)
      const sortedByPerformance = report.staffDetails.sort((a, b) => {
        const scoreA = (a.qualityScore * 0.4) + (a.efficiency * 0.4) + (a.tasksCompleted * 0.2);
        const scoreB = (b.qualityScore * 0.4) + (b.efficiency * 0.4) + (b.tasksCompleted * 0.2);
        return scoreB - scoreA;
      });

      const topCount = Math.max(1, Math.ceil(staff.length * 0.2));
      const bottomCount = Math.max(1, Math.ceil(staff.length * 0.2));

      report.summary.topPerformers = sortedByPerformance.slice(0, topCount);
      report.summary.improvementNeeded = sortedByPerformance.slice(-bottomCount);

      this.logger.info(`Staff performance report generated for ${staff.length} members`);
      return report;
    } catch (error) {
      this.logger.error('Error generating staff performance report:', error);
      throw new Error(`Failed to generate performance report: ${error.message}`);
    }
  }

  /**
   * Generate equipment utilization report
   * @param {Object} filters - Report filters
   * @returns {Promise<Object>} Utilization report
   */
  async generateEquipmentUtilizationReport(filters = {}) {
    try {
      let predicate = 'obj.status !== "out_of_service"';

      if (filters.type) {
        predicate += ` && obj.type === '${filters.type}'`;
      }

      const equipment = await this.dataServe.jsonFind('equipment', { predicate });

      const report = {
        generatedAt: new Date().toISOString(),
        filters,
        summary: {
          totalEquipment: equipment.length,
          averageUtilization: 0,
          inUseCount: 0,
          availableCount: 0,
          maintenanceCount: 0,
          highUtilization: [],
          lowUtilization: []
        },
        equipmentDetails: []
      };

      let totalUtilization = 0;

      for (const item of equipment) {
        // Calculate utilization based on assignment time in last 30 days
        const utilizationRate = await this.calculateEquipmentUtilization(item.assetId, 30);
        totalUtilization += utilizationRate;

        report.equipmentDetails.push({
          assetId: item.assetId,
          name: item.name,
          type: item.type,
          status: item.status,
          utilizationRate,
          totalHours: item.maintenance.totalHours,
          lastService: item.maintenance.lastService,
          assignedTo: item.assignedTo
        });

        // Count by status
        switch (item.status) {
          case 'in_use':
            report.summary.inUseCount++;
            break;
          case 'available':
            report.summary.availableCount++;
            break;
          case 'maintenance':
            report.summary.maintenanceCount++;
            break;
        }
      }

      if (equipment.length > 0) {
        report.summary.averageUtilization = Math.round(totalUtilization / equipment.length);
      }

      // Identify high/low utilization equipment
      const sortedByUtilization = report.equipmentDetails.sort((a, b) => b.utilizationRate - a.utilizationRate);

      report.summary.highUtilization = sortedByUtilization
        .filter(item => item.utilizationRate > 80)
        .slice(0, 5);

      report.summary.lowUtilization = sortedByUtilization
        .filter(item => item.utilizationRate < 20)
        .slice(-5);

      this.logger.info(`Equipment utilization report generated for ${equipment.length} items`);
      return report;
    } catch (error) {
      this.logger.error('Error generating equipment utilization report:', error);
      throw new Error(`Failed to generate utilization report: ${error.message}`);
    }
  }

  /**
   * Calculate equipment utilization rate
   * @param {string} assetId - Equipment asset ID
   * @param {number} days - Period in days
   * @returns {Promise<number>} Utilization percentage
   */
  async calculateEquipmentUtilization(assetId, days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffIso = cutoffDate.toISOString();

      // Get assignments in the period
      const assignments = await this.dataServe.jsonFind('equipment_assignments', {
        predicate: `obj.assetId === '${assetId}' && obj.assignedAt >= '${cutoffIso}'`
      });

      let totalUsageTime = 0;
      const now = new Date();

      for (const assignment of assignments) {
        const startTime = new Date(assignment.assignedAt);
        const endTime = assignment.returnedAt ? new Date(assignment.returnedAt) : now;
        const usageTime = endTime - startTime;
        totalUsageTime += usageTime;
      }

      // Calculate utilization as percentage of available time
      const totalPeriodTime = days * 24 * 60 * 60 * 1000; // ms
      const utilizationRate = Math.round((totalUsageTime / totalPeriodTime) * 100);

      return Math.min(utilizationRate, 100); // Cap at 100%
    } catch (error) {
      this.logger.error('Error calculating equipment utilization:', error);
      return 0;
    }
  }
}

module.exports = ResourceModule;