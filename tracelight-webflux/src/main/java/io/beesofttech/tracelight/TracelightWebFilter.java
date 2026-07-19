package io.beesofttech.tracelight;

import org.springframework.core.Ordered;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Reactive counterpart of the servlet {@code TraceFilter}. Opens a {@link TraceContext} for each
 * request, rooted at an entry node named {@code "METHOD /path"}, and seeds it into the Reactor
 * Context under {@link TraceContextThreadLocalAccessor#KEY}. With automatic context propagation
 * enabled, the context is then restored on every downstream operator thread, so
 * {@link Tracelight#hit(String)} works unchanged. Tracelight's own endpoints are skipped.
 */
public class TracelightWebFilter implements WebFilter, Ordered {

    private final GraphRegistry registry;
    private final TracelightBroadcaster broadcaster;
    private final String basePath;

    public TracelightWebFilter(GraphRegistry registry, TracelightBroadcaster broadcaster, String basePath) {
        this.registry = registry;
        this.broadcaster = broadcaster;
        this.basePath = basePath;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        if (path != null && path.startsWith(basePath)) {
            return chain.filter(exchange);
        }

        String method = exchange.getRequest().getMethod().name();
        String entryId = method + " " + path;

        GraphRegistry.NodeState created = registry.ensureEntry(entryId, entryId);
        if (created != null) {
            broadcaster.onTopologyNode(created);
        }
        // Count the request on its entry node so the route's counter reflects live traffic.
        broadcaster.onEntryHit(entryId, registry.recordEntryHit(entryId));

        TraceContext ctx = TraceContext.start(entryId);
        broadcaster.onTraceOpen(ctx.traceId(), entryId);
        return chain.filter(exchange)
                // By terminal-signal time the shared ctx holds the last point the request hit
                // (== entryId when nothing fired): records the terminal hop into the
                // "Return <entry>" node and closes the trace. doFinally covers complete,
                // error and cancel alike.
                .doFinally(signal -> broadcaster.onTraceComplete(
                        ctx.traceId(), ctx.currentNodeId(), entryId, ctx.lastHitNanos()))
                .contextWrite(context -> context.put(TraceContextThreadLocalAccessor.KEY, ctx));
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }
}
