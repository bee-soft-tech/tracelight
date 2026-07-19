package io.beesofttech.tracelight.demo;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

@RestController
public class DemoController {

    private final OrderService orderService;
    private final CatalogService catalogService;

    public DemoController(OrderService orderService, CatalogService catalogService) {
        this.orderService = orderService;
        this.catalogService = catalogService;
    }

    @PostMapping("/order")
    public Mono<ResponseEntity<Map<String, Object>>> order(@RequestBody Order order) {
        return orderService.validate(order).flatMap(valid -> {
            if (!valid) {
                return Mono.just(ResponseEntity.badRequest().body(Map.of("status", "rejected")));
            }
            return orderService.checkInventory(order)
                    .then(orderService.charge(order))
                    .then(orderService.ship(order))
                    .thenReturn(ResponseEntity.ok(Map.of("status", "ok")));
        });
    }

    @GetMapping("/search")
    public Mono<Map<String, Object>> search(
            @RequestParam(required = false, defaultValue = "") String q) {
        return catalogService.search(q).thenReturn(Map.of("status", "ok"));
    }
}
