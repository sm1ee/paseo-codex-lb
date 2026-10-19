import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences, snapshotRpc, loginRpc, logoutRpc, forgetLoginRpc } from "./shared/contracts";
import { LBService } from "./server/service";
import { usageSource } from "./server/usage-source";
import { AccountService } from "./server/accounts";
import { accountActionRpc, resetPreviewRpc, resetConsumeRpc } from "./shared/actions";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const service = new LBService(settings);
  const accounts = new AccountService(service);
  server.handle(snapshotRpc, ({ refresh }) => service.snapshot(refresh));
  server.handle(loginRpc, (input) => service.login(input));
  server.handle(logoutRpc, ({ serverUrl }) => service.logout(serverUrl));
  server.handle(forgetLoginRpc, ({ serverUrl }) => service.forgetLogin(serverUrl));
  server.handle(accountActionRpc, (input) => accounts.action(input));
  server.handle(resetPreviewRpc, ({ serverUrl, accountId }) => accounts.preview(serverUrl, accountId));
  server.handle(resetConsumeRpc, ({ serverUrl, accountId, confirmationId }) => accounts.consume(serverUrl, accountId, confirmationId));
  server.registerUsageSource(usageSource(service));
  const unsubscribe = settings.subscribe((state) => { if (state.status === "ready") service.changed(state.values); });
  return () => { unsubscribe(); accounts.stop(); service.stop(); };
}
