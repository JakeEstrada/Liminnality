const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScopePlugin');

const taskSchema = new mongoose.Schema({
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  },
  // When set, this task belongs to a project (the project is also a Task with isProject: true)
  projectTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    default: 0,
    min: 0
  },
  dueDate: {
    type: Date
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  isUrgent: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    enum: [
      'follow_up',
      'send_estimate',
      'review_design',
      'collect_deposit',
      'schedule_install',
      'site_visit',
      'quality_check',
      'collect_payment',
      'other'
    ],
    default: 'follow_up'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  completedAt: {
    type: Date
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Project fields
  isProject: {
    type: Boolean,
    default: false
  },
  notes: [{
    content: {
      type: String,
      required: true,
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  updates: [{
    content: {
      type: String,
      required: true,
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

taskSchema.plugin(tenantScopePlugin);

// Indexes for querying
taskSchema.index({ jobId: 1, completedAt: 1 });
taskSchema.index({ projectTaskId: 1, completedAt: 1 });
taskSchema.index({ assignedTo: 1, completedAt: 1, dueDate: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ isProject: 1, completedAt: 1 });

// Virtual for checking if overdue
taskSchema.virtual('isOverdue').get(function() {
  if (this.completedAt) return false;
  return this.dueDate < new Date();
});

// Virtual for checking if completed
taskSchema.virtual('isCompleted').get(function() {
  return !!this.completedAt;
});

taskSchema.set('toJSON', { virtuals: true });
taskSchema.set('toObject', { virtuals: true });

taskSchema.post('save', function rememberTask(doc) {
  try {
    const { scheduleTaskMemory } = require('../services/jobMemory');
    scheduleTaskMemory(doc);
  } catch (error) {
    console.error('Task memory failed:', error?.message || error);
  }
});

taskSchema.post('findOneAndDelete', function forgetTask(doc) {
  if (!doc) return;
  try {
    const { removeTaskMemory } = require('../services/jobMemory');
    removeTaskMemory(doc).catch((error) => {
      console.error('Task memory delete failed:', error?.message || error);
    });
  } catch (error) {
    console.error('Task memory delete failed:', error?.message || error);
  }
});

module.exports = mongoose.model('Task', taskSchema);