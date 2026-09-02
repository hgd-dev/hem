package com.hemcraft.gate;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.plugin.java.JavaPlugin;
import com.destroystokyo.paper.profile.PlayerProfile;
import com.destroystokyo.paper.profile.ProfileProperty;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class HEMGatePlugin extends JavaPlugin implements Listener {
    private static final String SESSION_CHANNEL = "hem:session";
    private static final long RESUME_TTL_MS = 5 * 60 * 1000L;

    private final Set<UUID> authenticated = ConcurrentHashMap.newKeySet();
    private final Map<String, SessionLease> resumeSessions = new ConcurrentHashMap<>();
    private final SecureRandom secureRandom = new SecureRandom();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private String worldId;
    private String hubUrl;
    private String serviceKey;
    private String orchestratorUrl;
    private String orchestratorKey;
    private int timeoutSeconds;
    private boolean allowCommands;

    private record SessionLease(
        String username,
        String displayName,
        String skinModel,
        String skinUrl,
        boolean commandsAuthorized,
        long expiresAt
    ) {}

    @Override public void onEnable() {
        saveDefaultConfig(); reloadConfig();
        worldId = getConfig().getString("world-id", "");
        hubUrl = trimSlash(getConfig().getString("hub-url", ""));
        serviceKey = getConfig().getString("service-key", "");
        orchestratorUrl = trimSlash(getConfig().getString("orchestrator-url", ""));
        orchestratorKey = getConfig().getString("orchestrator-key", "");
        timeoutSeconds = Math.max(5, getConfig().getInt("auth-timeout-seconds", 45));
        allowCommands = getConfig().getBoolean("allow-commands", true);
        if (!worldId.matches("^w_[a-f0-9]{20}$") || hubUrl.isBlank() || serviceKey.length() < 16) {
            getLogger().severe("HEMGate configuration is invalid. Refusing to authorize players.");
        }
        getServer().getMessenger().registerOutgoingPluginChannel(this, SESSION_CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, this);
        getLogger().info("HEMGate active for " + worldId + " on Paper " + Bukkit.getMinecraftVersion());
    }

    @Override public void onDisable() {
        getServer().getMessenger().unregisterOutgoingPluginChannel(this, SESSION_CHANNEL);
        authenticated.clear();
        resumeSessions.clear();
    }

    private static String trimSlash(String s) { return s == null ? "" : s.replaceAll("/+$", ""); }
    private boolean locked(Player p) { return !authenticated.contains(p.getUniqueId()); }

    @EventHandler(priority = EventPriority.LOWEST) public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        authenticated.remove(p.getUniqueId());
        p.setInvulnerable(true);
        p.setCollidable(false);
        p.sendMessage(ChatColor.GOLD + "HEM: authorizing this 1.21.5 world…");
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (p.isOnline() && locked(p)) p.kickPlayer("HEM launch authorization expired. Return to the HEM world menu and launch again.");
        }, timeoutSeconds * 20L);
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player p)) return true;
        if (args.length != 2) {
            p.sendMessage(ChatColor.RED + "Launch this world from HEM.");
            return true;
        }
        if (!locked(p)) return true;
        String mode = args[0].toLowerCase();
        String token = args[1];
        if (token.length() < 32 || token.length() > 256 || !token.matches("^[A-Za-z0-9_-]+$")) {
            p.kickPlayer("Invalid HEM session token.");
            return true;
        }
        if (mode.equals("auth")) {
            authorizeAsync(p, token);
            return true;
        }
        if (mode.equals("resume")) {
            resumeSession(p, token);
            return true;
        }
        p.sendMessage(ChatColor.RED + "Launch this world from HEM.");
        return true;
    }

    private void authorizeAsync(Player p, String token) {
        String username = p.getName(); UUID uuid = p.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(hubUrl + "/api/server/consume-launch"))
                    .timeout(Duration.ofSeconds(8)).header("content-type", "text/plain")
                    .header("x-hem-service-key", serviceKey).header("x-hem-world-id", worldId)
                    .header("x-hem-player", username).POST(HttpRequest.BodyPublishers.ofString(token)).build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                String body = res.body() == null ? "" : res.body();
                if (res.statusCode() != 200 || !body.startsWith("OK\t")) { denyOnMain(uuid, "HEM authorization rejected."); return; }
                String[] fields = body.split("\t", 5);
                String displayName = fields.length > 1 ? fields[1].replaceAll("[\r\n\t]", " ").trim() : "";
                String skinModel = fields.length > 2 && fields[2].equalsIgnoreCase("slim") ? "slim" : "classic";
                String skinUrl = fields.length > 3 ? fields[3].replaceAll("[\r\n\t]", "").trim() : "";
                boolean commandsAuthorized = allowCommands && fields.length > 4 && fields[4].equals("1");
                SessionLease lease = new SessionLease(username, displayName, skinModel, skinUrl, commandsAuthorized, System.currentTimeMillis() + RESUME_TTL_MS);
                Bukkit.getScheduler().runTask(this, () -> {
                    Player live = Bukkit.getPlayer(uuid);
                    if (live == null || !live.isOnline()) return;
                    completeAuthorization(live, lease, "connected");
                });
            } catch (Exception ex) {
                getLogger().warning("Authorization error for " + username + ": " + ex);
                denyOnMain(uuid, "HEM authorization service unavailable.");
            }
        });
    }

    private void resumeSession(Player player, String token) {
        cleanupResumeSessions();
        SessionLease lease = resumeSessions.remove(token);
        if (lease == null || lease.expiresAt() < System.currentTimeMillis() || !lease.username().equalsIgnoreCase(player.getName())) {
            player.kickPlayer("HEM resume session expired. Return to the HEM world menu and launch again.");
            return;
        }
        completeAuthorization(player, lease, "resumed");
    }

    private void completeAuthorization(Player player, SessionLease lease, String verb) {
        authenticated.add(player.getUniqueId());
        player.setInvulnerable(false);
        player.setCollidable(true);
        if (!lease.displayName().isBlank()) {
            player.setDisplayName(lease.displayName());
            player.setPlayerListName(lease.displayName());
        }
        if (!lease.skinUrl().isBlank()) applyHemSkin(player, lease.skinUrl(), lease.skinModel());
        player.setOp(lease.commandsAuthorized());

        player.sendMessage(ChatColor.GREEN + "HEM: " + verb + " to " + worldId + ".");
        postPresence(player, true);
        issueResumeSession(player, lease);
    }

    private void issueResumeSession(Player player, SessionLease source) {
        issueResumeSessionWhenListening(player, source, 0);
    }

    private void issueResumeSessionWhenListening(Player player, SessionLease source, int attempt) {
        if (!player.isOnline()) return;
        // Modern clients advertise custom plugin channels with minecraft:register.
        // HEM's browser bridge registers hem:session before sending /hem auth or
        // /hem resume. Do not fire the one-use lease before Paper has observed that
        // registration; doing so can lose the payload on historical web-client
        // protocol builds and leaves refresh recovery impossible.
        if (!player.getListeningPluginChannels().contains(SESSION_CHANNEL)) {
            if (attempt < 40) {
                Bukkit.getScheduler().runTaskLater(this, () -> issueResumeSessionWhenListening(player, source, attempt + 1), 2L);
            } else {
                getLogger().warning("Resume channel was not registered by " + player.getName() + "; no lease was issued.");
            }
            return;
        }
        cleanupResumeSessions();
        byte[] random = new byte[32];
        secureRandom.nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        SessionLease rotated = new SessionLease(
            player.getName(), source.displayName(), source.skinModel(), source.skinUrl(), source.commandsAuthorized(), System.currentTimeMillis() + RESUME_TTL_MS
        );
        resumeSessions.put(token, rotated);
        player.sendPluginMessage(this, SESSION_CHANNEL, token.getBytes(StandardCharsets.UTF_8));
    }

    private void cleanupResumeSessions() {
        long now = System.currentTimeMillis();
        resumeSessions.entrySet().removeIf(entry -> entry.getValue().expiresAt() < now);
    }

    private void applyHemSkin(Player player, String skinUrl, String skinModel) {
        try {
            URI uri = URI.create(skinUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) {
                getLogger().warning("Rejected non-HTTP HEM skin URL for " + player.getName());
                return;
            }
            String modelMetadata = "slim".equalsIgnoreCase(skinModel) ? ",\"metadata\":{\"model\":\"slim\"}" : "";
            String texturesJson = "{\"textures\":{\"SKIN\":{\"url\":\"" + jsonEscape(skinUrl) + "\"" + modelMetadata + "}}}";
            String encoded = Base64.getEncoder().encodeToString(texturesJson.getBytes(StandardCharsets.UTF_8));
            PlayerProfile profile = player.getPlayerProfile();
            profile.setProperty(new ProfileProperty("textures", encoded));
            player.setPlayerProfile(profile);

            // The player-info packet may have reached existing clients before HEM auth
            // completes. Re-hide/show the player so connected browsers receive the new
            // profile/skin immediately instead of only after their next reconnect.
            Bukkit.getScheduler().runTask(this, () -> {
                for (Player viewer : Bukkit.getOnlinePlayers()) {
                    if (viewer.getUniqueId().equals(player.getUniqueId())) continue;
                    viewer.hidePlayer(this, player);
                    viewer.showPlayer(this, player);
                }
            });
        } catch (Exception ex) {
            getLogger().warning("Could not apply HEM skin for " + player.getName() + ": " + ex.getMessage());
        }
    }

    private void denyOnMain(UUID uuid, String reason) {
        Bukkit.getScheduler().runTask(this, () -> {
            Player p = Bukkit.getPlayer(uuid);
            if (p != null) p.kickPlayer(reason);
        });
    }

    private static String jsonEscape(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }

    private void postPresence(Player player, boolean connected) {
        if (orchestratorUrl.isBlank() || orchestratorKey.isBlank()) return;
        String json = "{\"worldId\":\"" + worldId + "\",\"player\":\"" + jsonEscape(player.getName()) + "\",\"connected\":" + connected + ",\"at\":" + System.currentTimeMillis() + "}";
        HttpRequest req = HttpRequest.newBuilder(URI.create(orchestratorUrl + "/internal/presence"))
            .timeout(Duration.ofSeconds(3)).header("content-type", "application/json").header("x-hem-service-key", orchestratorKey)
            .POST(HttpRequest.BodyPublishers.ofString(json)).build();
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding()).exceptionally(ex -> null);
    }

    @EventHandler public void onQuit(PlayerQuitEvent e) { if (authenticated.remove(e.getPlayer().getUniqueId())) postPresence(e.getPlayer(), false); }
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onMove(PlayerMoveEvent e) { if (!locked(e.getPlayer()) || e.getTo()==null) return; Location f=e.getFrom(),t=e.getTo(); if (f.getX()!=t.getX()||f.getY()!=t.getY()||f.getZ()!=t.getZ()) e.setTo(new Location(f.getWorld(),f.getX(),f.getY(),f.getZ(),t.getYaw(),t.getPitch())); }
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onBreak(BlockBreakEvent e){if(locked(e.getPlayer()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onPlace(BlockPlaceEvent e){if(locked(e.getPlayer()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onInteract(PlayerInteractEvent e){if(locked(e.getPlayer()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onDrop(PlayerDropItemEvent e){if(locked(e.getPlayer()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onSwap(PlayerSwapHandItemsEvent e){if(locked(e.getPlayer()))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onOpen(InventoryOpenEvent e){if(e.getPlayer() instanceof Player p && locked(p))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onClick(InventoryClickEvent e){if(e.getWhoClicked() instanceof Player p && locked(p))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onDamage(EntityDamageEvent e){if(e.getEntity() instanceof Player p && locked(p))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onDamageBy(EntityDamageByEntityEvent e){if(e.getDamager() instanceof Player p && locked(p))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onPickup(EntityPickupItemEvent e){if(e.getEntity() instanceof Player p && locked(p))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onFood(FoodLevelChangeEvent e){if(e.getEntity() instanceof Player p && locked(p))e.setCancelled(true);}
    @EventHandler(ignoreCancelled=true, priority=EventPriority.LOWEST) public void onPreCommand(PlayerCommandPreprocessEvent e){
        if (!locked(e.getPlayer())) return;
        String message = e.getMessage().toLowerCase();
        if (!message.startsWith("/hem auth ") && !message.startsWith("/hem resume ")) e.setCancelled(true);
    }
}
