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
    this.nextSeq = jest.fn().mockImplementation(() => ++this.seqCounter);
    // These methods just resolve immediately for tests
    this.waitForDevice = jest.fn().mockResolvedValue();
    this.waitForIdle = jest.fn().mockResolvedValue();
    this.waitForBusy = jest.fn().mockResolvedValue();
    // DO NOT mock .on, .emit, .removeListener – they come from EventEmitter
  }

  emitDoseComplete(seq, volume) {
    this.emit("pump_message", {
      seq,
      status: "dose_complete",
      volume_ml: volume,
    });
  }
}

module.exports = MockMqttService;
