const EventEmitter = require("events");

class MockMqttService extends EventEmitter {
  constructor() {
    super();
    this.deviceRegistry = { pump_node_1: "online", sensor_node_1: "online" };
    this.seqCounter = 0;
    this.hardwareStatus = "idle";
    this.hardwareTask = null;
    this.hardwareSeq = null;
    this.sendCommand = jest
      .fn()
      .mockImplementation((action, ml, target, seq) => {
        this.activeCommand = { action, ml, target, seq };
        return seq || ++this.seqCounter;
      });
    this.waitForDevice = jest.fn().mockResolvedValue();
    this.waitForIdle = jest.fn().mockResolvedValue();
    this.waitForBusy = jest.fn().mockResolvedValue();
    this.nextSeq = jest.fn().mockImplementation(() => ++this.seqCounter);
    this.on = jest.fn();
    this.emit = jest.fn();
    this.removeListener = jest.fn();
  }

  // Helper to simulate a dose completion
  emitDoseComplete(seq, volume) {
    this.emit("pump_message", {
      seq,
      status: "dose_complete",
      volume_ml: volume,
    });
  }
}

module.exports = MockMqttService;
