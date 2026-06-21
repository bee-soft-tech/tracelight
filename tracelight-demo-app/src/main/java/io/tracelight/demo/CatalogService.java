package io.tracelight.demo;

import io.tracelight.TracePoint;
import io.tracelight.Tracelight;
import org.springframework.stereotype.Service;

/** A second flow (the {@code GET /search} entry node) to show multiple roots in the graph. */
@Service
public class CatalogService {

    @TracePoint("search")
    public void search(String query) {
        if (query == null || query.isBlank()) {
            Tracelight.hit("empty-query");
            return;
        }
        if (query.length() > 10) {
            Tracelight.hit("long-query");
        } else {
            Tracelight.hit("short-query");
        }
        Tracelight.hit("query-db");
    }
}
