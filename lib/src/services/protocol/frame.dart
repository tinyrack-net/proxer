import 'dart:convert';
import 'dart:typed_data';

import 'package:proxer/src/services/protocol/subdomain.dart';
import 'package:proxer/src/util/error.dart';
import 'package:proxer/src/util/headers.dart';

enum RouteMode {
  single,
  cluster;

  String get value => name;

  static RouteMode? tryParse(Object? value) {
    return switch (value) {
      'single' => RouteMode.single,
      'cluster' => RouteMode.cluster,
      _ => null,
    };
  }
}

sealed class TunnelFrame {
  const TunnelFrame();

  String get type;
  Map<String, Object?> toJson();
}

class BasicAuthConfig {
  const BasicAuthConfig({required this.password, this.username});

  final String password;
  final String? username;

  Map<String, Object?> toJson() {
    final result = <String, Object?>{'password': password};
    if (username != null) {
      result['username'] = username;
    }
    return result;
  }
}

class RegisterFrame extends TunnelFrame {
  const RegisterFrame({
    this.root,
    this.subdomain,
    this.mode,
    this.token,
    this.basicAuth,
  });

  final bool? root;
  final String? subdomain;
  final RouteMode? mode;
  final String? token;
  final BasicAuthConfig? basicAuth;

  @override
  String get type => 'register';

  @override
  Map<String, Object?> toJson() {
    final result = <String, Object?>{'type': type};
    if (root == true) {
      result['root'] = true;
    }
    if (subdomain != null) {
      result['subdomain'] = subdomain;
    }
    if (mode != null) {
      result['mode'] = mode!.value;
    }
    if (token != null) {
      result['token'] = token;
    }
    if (basicAuth != null) {
      result['basicAuth'] = basicAuth!.toJson();
    }
    return result;
  }
}

class RegisteredFrame extends TunnelFrame {
  const RegisteredFrame({this.subdomain, this.mode, this.replicas});

  final String? subdomain;
  final RouteMode? mode;
  final int? replicas;

  @override
  String get type => 'registered';

  @override
  Map<String, Object?> toJson() {
    final result = <String, Object?>{'type': type};
    if (subdomain != null) {
      result['subdomain'] = subdomain;
    }
    if (mode != null) {
      result['mode'] = mode!.value;
    }
    if (replicas != null) {
      result['replicas'] = replicas;
    }
    return result;
  }
}

class OpenFrame extends TunnelFrame {
  const OpenFrame({
    required this.streamId,
    required this.kind,
    required this.method,
    required this.path,
    required this.headers,
  });

  final String streamId;
  final String kind;
  final String method;
  final String path;
  final HeaderMap headers;

  @override
  String get type => 'open';

  @override
  Map<String, Object?> toJson() => {
    'type': type,
    'streamId': streamId,
    'kind': kind,
    'method': method,
    'path': path,
    'headers': _headersToJson(headers),
  };
}

class HeadersFrame extends TunnelFrame {
  const HeadersFrame({
    required this.streamId,
    required this.status,
    required this.headers,
  });

  final String streamId;
  final int status;
  final HeaderMap headers;

  @override
  String get type => 'headers';

  @override
  Map<String, Object?> toJson() => {
    'type': type,
    'streamId': streamId,
    'status': status,
    'headers': _headersToJson(headers),
  };
}

class DataFrame extends TunnelFrame {
  const DataFrame({
    required this.streamId,
    required this.direction,
    required this.data,
  });

  final String streamId;
  final String direction;
  final String data;

  @override
  String get type => 'data';

  @override
  Map<String, Object?> toJson() => {
    'type': type,
    'streamId': streamId,
    'direction': direction,
    'data': data,
  };
}

class EndFrame extends TunnelFrame {
  const EndFrame({required this.streamId, required this.direction});

  final String streamId;
  final String direction;

  @override
  String get type => 'end';

  @override
  Map<String, Object?> toJson() => {
    'type': type,
    'streamId': streamId,
    'direction': direction,
  };
}

class ErrorFrame extends TunnelFrame {
  const ErrorFrame({required this.streamId, required this.message});

  final String streamId;
  final String message;

  @override
  String get type => 'error';

  @override
  Map<String, Object?> toJson() => {
    'type': type,
    'streamId': streamId,
    'message': message,
  };
}

class CloseFrame extends TunnelFrame {
  const CloseFrame({required this.streamId});

  final String streamId;

  @override
  String get type => 'close';

  @override
  Map<String, Object?> toJson() => {'type': type, 'streamId': streamId};
}

class ProtocolError extends ProxerError {
  ProtocolError(super.message);
}

Map<String, Object?> _asMap(Object? value) {
  if (value is! Map) {
    throw ProtocolError('Invalid tunnel frame');
  }
  return value.map((key, item) => MapEntry('$key', item));
}

String _requiredString(Map<String, Object?> map, String key) {
  final value = map[key];
  if (value is! String || value.isEmpty) {
    throw ProtocolError('Invalid tunnel frame');
  }
  return value;
}

String? _optionalString(Map<String, Object?> map, String key) {
  final value = map[key];
  if (value == null) {
    return null;
  }
  if (value is! String) {
    throw ProtocolError('Invalid tunnel frame');
  }
  return value;
}

String _direction(Map<String, Object?> map) {
  final value = _requiredString(map, 'direction');
  if (value != 'request' && value != 'response') {
    throw ProtocolError('Invalid tunnel frame');
  }
  return value;
}

HeaderMap _headers(Object? value) {
  final map = _asMap(value);
  return map.map((key, item) {
    if (item is String) {
      return MapEntry(key, [item]);
    }
    if (item is List && item.every((entry) => entry is String)) {
      return MapEntry(key, item.cast<String>());
    }
    throw ProtocolError('Invalid tunnel frame');
  });
}

Map<String, Object> _headersToJson(HeaderMap headers) {
  return headers.map(
    (key, values) => MapEntry(key, values.length == 1 ? values.single : values),
  );
}

TunnelFrame decodeFrame(Object payload) {
  final String text = switch (payload) {
    final String value => value,
    final List<int> value => utf8.decode(value),
    final ByteBuffer value => utf8.decode(value.asUint8List()),
    _ => throw ProtocolError('Invalid frame JSON'),
  };

  Object? value;
  try {
    value = jsonDecode(text);
  } on FormatException {
    throw ProtocolError('Invalid frame JSON');
  }

  final map = _asMap(value);
  if (map.containsKey('name')) {
    throw ProtocolError('Invalid tunnel frame');
  }
  final type = map['type'];

  switch (type) {
    case 'register':
      final root = map['root'];
      if (root != null && root != true) {
        throw ProtocolError('Invalid tunnel frame');
      }
      final subdomain = _optionalString(map, 'subdomain');
      if (root == true && subdomain != null ||
          subdomain != null && !isTunnelSubdomain(subdomain)) {
        throw ProtocolError('Invalid tunnel frame');
      }
      final modeValue = map['mode'];
      final mode = modeValue == null ? null : RouteMode.tryParse(modeValue);
      if (modeValue != null && mode == null) {
        throw ProtocolError('Invalid tunnel frame');
      }
      BasicAuthConfig? basicAuth;
      if (map['basicAuth'] case final auth?) {
        final authMap = _asMap(auth);
        final password = _requiredString(authMap, 'password');
        final username = _optionalString(authMap, 'username');
        if (username != null && username.isEmpty) {
          throw ProtocolError('Invalid tunnel frame');
        }
        basicAuth = BasicAuthConfig(password: password, username: username);
      }
      return RegisterFrame(
        root: root == true,
        subdomain: subdomain,
        mode: mode,
        token: _optionalString(map, 'token'),
        basicAuth: basicAuth,
      );
    case 'registered':
      final subdomain = _optionalString(map, 'subdomain');
      if (subdomain != null && !isTunnelSubdomain(subdomain)) {
        throw ProtocolError('Invalid tunnel frame');
      }
      final modeValue = map['mode'];
      final mode = modeValue == null ? null : RouteMode.tryParse(modeValue);
      if (modeValue != null && mode == null) {
        throw ProtocolError('Invalid tunnel frame');
      }
      final replicas = map['replicas'];
      if (replicas != null && (replicas is! int || replicas < 1)) {
        throw ProtocolError('Invalid tunnel frame');
      }
      return RegisteredFrame(
        subdomain: subdomain,
        mode: mode,
        replicas: replicas as int?,
      );
    case 'open':
      final kind = _requiredString(map, 'kind');
      if (kind != 'http' && kind != 'websocket') {
        throw ProtocolError('Invalid tunnel frame');
      }
      return OpenFrame(
        streamId: _requiredString(map, 'streamId'),
        kind: kind,
        method: _requiredString(map, 'method'),
        path: _requiredString(map, 'path'),
        headers: _headers(map['headers']),
      );
    case 'headers':
      final status = map['status'];
      if (status is! int || status < 100 || status > 999) {
        throw ProtocolError('Invalid tunnel frame');
      }
      return HeadersFrame(
        streamId: _requiredString(map, 'streamId'),
        status: status,
        headers: _headers(map['headers']),
      );
    case 'data':
      final data = _requiredString(map, 'data');
      try {
        base64.decode(data);
      } on FormatException {
        throw ProtocolError('Invalid tunnel frame');
      }
      return DataFrame(
        streamId: _requiredString(map, 'streamId'),
        direction: _direction(map),
        data: data,
      );
    case 'end':
      return EndFrame(
        streamId: _requiredString(map, 'streamId'),
        direction: _direction(map),
      );
    case 'error':
      final message = map['message'];
      if (message is! String) {
        throw ProtocolError('Invalid tunnel frame');
      }
      return ErrorFrame(
        streamId: _requiredString(map, 'streamId'),
        message: message,
      );
    case 'close':
      return CloseFrame(streamId: _requiredString(map, 'streamId'));
    default:
      throw ProtocolError('Invalid tunnel frame');
  }
}

String encodeFrame(TunnelFrame frame) => jsonEncode(frame.toJson());
