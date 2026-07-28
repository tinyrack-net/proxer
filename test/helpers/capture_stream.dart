import 'package:cliweave/cliweave.dart';

class CaptureStream implements WriteStream {
  final StringBuffer _buffer = StringBuffer();

  String get text => _buffer.toString();

  @override
  bool get isTTY => false;

  @override
  void clearLine(int dir) {}

  @override
  void cursorTo(int column) {}

  @override
  void write(String chunk) => _buffer.write(chunk);
}
