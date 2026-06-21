package io.tracelight;

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

        String entryId = request.getMethod() + " " + uri;
        GraphRegistry.NodeState created = registry.ensureEntry(entryId, entryId);
        if (created != null) {
            broadcaster.onTopologyNode(created);
        }

        TraceContext.start(entryId);
        try {
            chain.doFilter(request, response);
        } finally {
            TraceContext.clear();
        }
    }
}
