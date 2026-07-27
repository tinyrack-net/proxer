const String appName = 'proxer';
const String defaultListenAddress = '127.0.0.1:8080';
const String defaultHttpServerUrl = 'ws://127.0.0.1:8080';
const String proxerInternalPrefix = '/__proxer__';
const String controlPath = '$proxerInternalPrefix/control';
const String healthLivePath = '$proxerInternalPrefix/health/live';
const String healthReadyPath = '$proxerInternalPrefix/health/ready';
