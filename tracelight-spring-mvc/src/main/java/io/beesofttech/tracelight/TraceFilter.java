package io.beesofttech.tracelight;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Opens a {@link TraceContext} for each HTTP request, rooted at an entry node
 * named {@code "METHOD /path"}, and clears it afterwards. Skips Tracelight's own
 * endpoints so the visualizer doesn't trace itself.
 */
public class TraceFilter extends OncePerRequestFilter {

    private final GraphRegistry registry;
    private final TracelightBroadcaster broadcaster;
    private final String basePath;

    public TraceFilter(GraphRegistry registry, TracelightBroadcaster broadcaster, String basePath) {
        this.registry = registry;
        this.broadcaster = broadcaster;
        this.basePath = basePath;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String uri = request.getRequestURI();
        if (uri != null && uri.startsWith(basePath)) {
            chain.doFilter(request, response);
            return;
        }

        var entryId = request.getMethod() + " " + uri;
        var created = registry.ensureEntry(entryId, entryId);
        if (created != null) {
            broadcaster.onTopologyNode(created);
        }
        // Count the request on its entry node so the route's counter reflects live traffic.
        broadcaster.onEntryHit(entryId, registry.recordEntryHit(entryId));

        TraceContext ctx = TraceContext.start(entryId);
        broadcaster.onTraceOpen(ctx.traceId(), entryId);
        try {
            chain.doFilter(request, response);
        } finally {
            // currentNodeId is the last point the request hit (== entryId when nothing fired):
            // records the terminal hop into the "Return <entry>" node and closes the trace.
            broadcaster.onTraceComplete(ctx.traceId(), ctx.currentNodeId(), entryId, ctx.lastHitNanos());
            TraceContext.clear();
        }
    }
}
