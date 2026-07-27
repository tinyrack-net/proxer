import 'dart:convert';
import 'dart:io';

import 'package:proxer/src/services/protocol/frame.dart';

bool _secureCompare(String left, String right) {
  final leftBytes = utf8.encode(left);
  final rightBytes = utf8.encode(right);
  var different = leftBytes.length ^ rightBytes.length;
  final length = leftBytes.length > rightBytes.length
      ? leftBytes.length
      : rightBytes.length;
  for (var index = 0; index < length; index += 1) {
    final a = index < leftBytes.length ? leftBytes[index] : 0;
    final b = index < rightBytes.length ? rightBytes[index] : 0;
    different |= a ^ b;
  }
  return different == 0;
}

bool verifyBasicAuthHeader(
  String? authorization,
  BasicAuthConfig? requirement,
) {
  if (requirement == null) {
    return true;
  }
  if (authorization == null ||
      !authorization.toLowerCase().startsWith('basic ')) {
    return false;
  }
  String decoded;
  try {
    decoded = utf8.decode(base64.decode(authorization.substring(6)));
  } on FormatException {
    return false;
  }
  final separator = decoded.indexOf(':');
  if (separator < 0) {
    return false;
  }
  final username = decoded.substring(0, separator);
  final password = decoded.substring(separator + 1);
  return _secureCompare(requirement.password, password) &&
      (requirement.username == null ||
          _secureCompare(requirement.username!, username));
}

Future<void> writeBasicAuthChallenge(HttpResponse response) async {
  response.statusCode = HttpStatus.unauthorized;
  response.headers
    ..contentType = ContentType.text
    ..set(HttpHeaders.wwwAuthenticateHeader, 'Basic realm="proxer"');
  response.write('Unauthorized\n');
  await response.close();
}
