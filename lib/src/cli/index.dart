import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/http.dart';
import 'package:proxer/src/cli/server.dart';
import 'package:proxer/src/cli/skill.dart';

RouteMap<ApplicationContext> buildRootRoute() {
  return buildRouteMap(
    docs: const RouteMapDocs(
      brief: 'Expose local services through reverse tunnels.',
    ),
    routes: {'server': serverCommand, 'http': httpCommand, 'skill': skillRoute},
  );
}
