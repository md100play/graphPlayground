import gHelp from "./util/graphHelpers";
import help from "./util/genericHelpers";
import GraphState from "./graphState";
import { FlowResult, MSTResult, ShortestPathResult } from "./GraphAlgorithms";
//@ts-ignore
import Worker from "worker-loader!./workers/GraphAlgorithmWorker";
import NodeImmut from "./classes/GraphImmut/NodeImmut";
import EdgeImmut from "./classes/GraphImmut/EdgeImmut";
import GraphImmut from "./classes/GraphImmut/GraphImmut";

interface AlgorithmI {
    name: string;
    directional?: boolean;
    weighted?: boolean;
    applyFunc: () => any;
    display: boolean;
}

const makeAndPrintShortestPath = (title: string, fn: string, weighted: boolean): void => {
    const myName = "Shortest Path";
    if (UIInteractions.isRunning[myName]) {
        UIInteractions.printAlreadyRunning(myName);
        return;
    }
    UIInteractions.isRunning[myName] = true;

    help.showFormModal(
        ($modal, values) => {
            $modal.modal("hide");

            const source = GraphState.nodeLabelToID(values[0]);
            const sink = GraphState.nodeLabelToID(values[1]);

            const iStartedProgress = UIInteractions.startLoadingAnimation();
            const w = UIInteractions.getWorkerIfPossible(e => {
                let a = e.data;
                w.cleanup();
                if (iStartedProgress) {
                    UIInteractions.stopLoadingAnimation();
                }
                UIInteractions.isRunning[myName] = false;

                if (a === false) {
                    if (title.includes("Dijkstra")) {
                        help.showSimpleModal(
                            "Dijkstra Error",
                            "<p>The Dijkstra algorithm only works on graphs" +
                                " with totally non-negative edge weights. Please fix the graph so that there are no" +
                                " negative edge weights.</p><p>Alternatively, try the Bellman-Ford algorithm which solves" +
                                " exactly this problem.</p>"
                        );
                    } else if (title.includes("Bellman")) {
                        help.showSimpleModal(
                            "Bellman-Ford Error",
                            "<p>The Bellman-Ford algorithm only works on graphs" +
                                " with no negative edge-weight cycles. Please remove the negative cycle and try again.</p>"
                        );
                    }
                    return;
                }

                a = a as ShortestPathResult;

                let p = `<h3>${title}</h3><hr>No path exists from ${help.htmlEncode(
                    source.toString()
                )} to ${help.htmlEncode(sink.toString())}`;

                if (a.pathExists) {
                    p = `${title} From ${GraphState.nodeIDToLabel(source)} to `;
                    p += `${GraphState.nodeIDToLabel(sink)}: ${a.distance}`;
                    if (weighted) {
                        p += `\nWith weighted cost: ${a.cost}`;
                    }
                    p += "\n\nUsing Path: ";

                    p = help.htmlEncode(p);
                    let graph = GraphState.getGraphData(GraphState.graph, false, true);
                    let G = new GraphImmut(graph.nodes, graph.edges, graph.directed, graph.weighted);
                    a.path.forEach((v: number, i: number) => {
                        p += `${help.htmlEncode(GraphState.nodeIDToLabel(v))} &rarr; `;
                        if (i > 0) {
                            G = G.editEdge(a.path[i - 1], v, null, null, "#FF0000") as GraphImmut;
                        }
                    });
                    GraphState.graph = G;
                    window.main.setData(GraphState.getGraphData(G), false, false, false);
                    p = p.slice(0, -8);
                    p = `<h3>${title}</h3><hr>${p}`;
                }

                help.printout(p);
            });
            w.send({
                type: fn,
                args: [source, sink],
                convertToGraphImmut: true,
                graph: window.main.graphState.getGraphData()
            });
        },
        title,
        "Go",
        [
            {
                label: "Start Node",
                type: "text",
                validationFunc: window.main.nodeLabelIDValidator
            },
            {
                label: "End Node",
                type: "text",
                validationFunc: window.main.nodeLabelIDValidator
            }
        ]
    );
};

const makeAndPrintComponents = async (stronglyConnected: boolean): Promise<void> => {
    let a = null;
    let cc = "Connected Components";
    let componentKey = "connectedComponents";

    if (stronglyConnected) {
        if (!window.settings.getOption("direction")) {
            return;
        }
        cc = "Strongly " + cc;
        componentKey = "stronglyConnectedComponents";
    } else {
        if (window.settings.getOption("direction")) {
            return;
        }
    }

    if (UIInteractions.isRunning[cc]) {
        UIInteractions.printAlreadyRunning(cc);
        return Promise.reject("Already Running");
    }
    UIInteractions.isRunning[cc] = true;

    const iStartedProgress = UIInteractions.startLoadingAnimation();
    const w = UIInteractions.getWorkerIfPossible(e => {
        a = e.data;
        w.cleanup();

        GraphState.graphProperties[cc] = a.count;
        GraphState.setUpToDate(true, [cc, componentKey]);
        GraphState.state[componentKey] = a.components;

        const components = help.flatten(a.components);
        let p = `Number of ${cc}: ${a.count}`;
        p += "\n\n";

        components.forEach((v, i) => {
            p += `Vertex ${GraphState.nodeIDToLabel(i)} is in connected component #${v}\n`;
        });

        p += `\n${JSON.stringify(help.rotate(a.components), null, 4)}\n\n`;
        p = `<h3>${cc}</h3><hr>${help.htmlEncode(p)}`;

        if (iStartedProgress) {
            UIInteractions.stopLoadingAnimation();
        }
        UIInteractions.isRunning[cc] = false;

        help.printout(p);
    });
    w.send({
        type: componentKey,
        args: [],
        graph: window.main.graphState.getGraphData(),
        convertToGraphImmut: true
    });
};

class WorkerProxy {
    private readonly worker: Worker;
    private readonly id: number;
    private readonly listener: (e: { data: any }) => any;

    constructor(id: number, w: Worker, listener: ((e: { data: any }) => any)) {
        this.id = id;
        this.worker = w;
        this.listener = listener;
        w.postMessage({ type: "id", id });
        w.onmessage = (e: MessageEvent) => {
            this.listener({ data: e.data.data });
        };
    }

    public send(data: any) {
        this.worker.postMessage(data);
    }

    public cleanup() {
        this.worker.terminate();
        GraphState.workerPool[this.id] = null;
    }
}

export default class UIInteractions {
    public static isRunning: { [index: string]: boolean } = {};
    static getAlgorithms(): AlgorithmI[] {
        return [
            {
                name: "Graph Coloring",
                directional: false,
                applyFunc: UIInteractions.makeAndPrintGraphColoring,
                display: true
            },
            {
                name: "Connected Components",
                directional: false,
                applyFunc: () => {
                    makeAndPrintComponents(false);
                },
                display: true
            },
            {
                name: "Strongly Connected Components",
                directional: true,
                display: true,
                applyFunc: () => {
                    makeAndPrintComponents(true);
                }
            },
            {
                name: "Breadth-First Shortest Path",
                directional: false,
                applyFunc: () => {
                    makeAndPrintShortestPath("Breadth-First Shortest Path", "breadthFirstSearch", false);
                },
                display: true
            },
            {
                name: "Dijkstra Shortest Path",
                applyFunc: () => {
                    makeAndPrintShortestPath("Dijkstra Shortest Path", "dijkstraSearch", true);
                },
                display: true
            },
            {
                name: "Bellman-Ford Shortest Path",
                weighted: true,
                directional: true,
                applyFunc: () => {
                    makeAndPrintShortestPath("Bellman-Ford Shortest Path", "bellmanFord", true);
                },
                display: true
            },
            {
                name: "Ford-Fulkerson",
                weighted: true,
                directional: true,
                applyFunc: UIInteractions.makeAndPrintFFMCMF,
                display: true
            },
            {
                name: "Kruskal Minimum Spanning Tree",
                weighted: true,
                directional: false,
                applyFunc: UIInteractions.makeAndPrintKruskal,
                display: true
            },
            {
                name: "Cyclic",
                applyFunc: UIInteractions.makeAndPrintIsCyclic,
                directional: true,
                display: true
            },
            {
                name: "Topological Sort",
                applyFunc: UIInteractions.makeAndPrintTopologicalSort,
                directional: true,
                display: true
            },
            {
                name: "Eulerian",
                directional: false,
                display: false,
                applyFunc: null
            },
            {
                name: "Eulerian",
                directional: true,
                display: true,
                applyFunc: UIInteractions.makeAndPrintDirectionalEulerian
            }
        ] as AlgorithmI[];
    }

    static registerListeners(): void {
        const makeSimpleClickListener = (selector: string, fn: () => any) => {
            document.querySelector(selector)!.addEventListener("click", e => {
                e.preventDefault();
                fn();
            });
        };

        makeSimpleClickListener("#print-help-link", UIInteractions.printHelp);
        makeSimpleClickListener("#graph-options-link", UIInteractions.printOptions);
        makeSimpleClickListener("#load-petersen-link", async () => {
            const predefined = (await import("./util/predefinedGraphs")).default;
            window.main.setData(predefined.Petersen(), false, true, true);
        });
        makeSimpleClickListener("#load-konigsberg-link", async () => {
            const predefined = (await import("./util/predefinedGraphs")).default;
            window.main.setData(predefined.Konigsberg(), false, true, true);
        });
        makeSimpleClickListener("#load-complete-link", async () => {
            const predefined = (await import("./util/predefinedGraphs")).default;
            predefined.Complete();
        });
        makeSimpleClickListener("#load-hypercube-link", async () => {
            const predefined = (await import("./util/predefinedGraphs")).default;
            predefined.Hypercube();
        });
        makeSimpleClickListener("#load-custom-link", async () => {
            const predefined = (await import("./util/predefinedGraphs")).default;
            predefined.Custom();
        });
        makeSimpleClickListener("#undo-link", window.main.undo);
        makeSimpleClickListener("#redo-link", window.main.redo);
        makeSimpleClickListener("#calculate-all-properties-link", async () => {
            return GraphState.makeAndPrintProperties(true);
        });
        makeSimpleClickListener("#new-graph-layout-link", window.main.shuffleNetworkLayout);
        makeSimpleClickListener("#import-file-link", async () => {
            const imp = (await import("./dataImportExport")).default;
            imp.makeImportFileModal();
        });
        makeSimpleClickListener("#import-text-link", async () => {
            const imp = (await import("./dataImportExport")).default;
            imp.makeImportTextModal();
        });
        makeSimpleClickListener("#export-file-link", async () => {
            const imp = (await import("./dataImportExport")).default;
            imp.makeExportFileModal();
        });
        makeSimpleClickListener("#export-text-link", async () => {
            const imp = (await import("./dataImportExport")).default;
            imp.makeExportTextModal();
        });
    }

    static printHelp(): void {
        help.showSimpleModal(
            "Help",
            "<h4>For support see the " +
                "<a href='https://github.com/MikeDombo/graphPlayground' target='_blank'>GitHub repository</a>" +
                " for guides</h4> <h4>See <a href='https://github.com/MikeDombo/graphPlayground/issues' target='_blank'>" +
                "GitHub issues</a> to submit bugs or feature requests.</h4>"
        );
    }

    static printOptions(): void {
        help.showFormModal(
            ($modal, vals) => {
                $modal.modal("hide");
                if (window.settings.getOption("nodePhysics") !== vals[0]) {
                    window.settings.changeOption("nodePhysics", vals[0]); // Physics
                }
                if (window.settings.getOption("direction") !== vals[1]) {
                    window.settings.changeOption("direction", vals[1]);
                    let G = GraphState.graph;
                    G = vals[1] ? G.asDirected(true) : G.asUndirected();
                    // Clear node coloring because graph color doesn't apply to directed graphs
                    window.main.setData(GraphState.getGraphData(G, true));
                }
                if (window.settings.getOption("weights") !== vals[2]) {
                    window.settings.changeOption("weights", vals[2]);
                    let G = GraphState.graph;
                    G = vals[2] ? G.asWeighted() : G.asUnweighted();
                    window.main.setData(GraphState.getGraphData(G));
                }
            },
            "Options",
            "Save",
            [
                {
                    label: "Graph Physics",
                    initialValue: window.settings.getOption("nodePhysics"),
                    type: "checkbox"
                },
                {
                    label: "Directed Graph",
                    initialValue: window.settings.getOption("direction"),
                    type: "checkbox"
                },
                {
                    label: "Weighted Graph",
                    initialValue: window.settings.getOption("weights"),
                    type: "checkbox"
                }
            ],
            null
        );
    }

    static terminateAllWebWorkers(): void {
        for (const v of GraphState.workerPool) {
            if (v !== null && v instanceof window.Worker) {
                v.terminate();
            }
        }
        GraphState.workerPool = [];
    }

    static getWorkerIfPossible(onmessage: (d: { data: any }) => any): WorkerProxy {
        let nextIndex = GraphState.workerPool.findIndex(v => {
            return v === null || typeof v === "undefined";
        });
        if (nextIndex === -1) {
            nextIndex = GraphState.workerPool.length;
        }

        const w = new Worker();
        GraphState.workerPool[nextIndex] = w;
        return new WorkerProxy(nextIndex, w, onmessage);
    }

    static startLoadingAnimation() {
        const prog = document.getElementById("task-spinner")!;
        if (prog.style.display !== "flex") {
            prog.style.display = "flex";
            return true;
        }
        return false;
    }

    static stopLoadingAnimation() {
        const prog = document.getElementById("task-spinner")!;
        if (prog.style.display !== "none") {
            prog.style.display = "none";
        }
    }

    static printAlreadyRunning(name?: string) {
        let n = "This task";
        if (name) {
            n = name;
        }
        help.showSimpleModal(
            "Task Already Running",
            "<p>" + n + " is already running, please wait for it to finish first.</p>"
        );
    }

    static makeAndPrintGraphColoring(): Promise<void> {
        const myName = "Graph Coloring";
        if (UIInteractions.isRunning[myName]) {
            UIInteractions.printAlreadyRunning(myName);
            return Promise.reject("Already Running");
        }
        UIInteractions.isRunning[myName] = true;

        return new Promise<void>(async resolve => {
            if (window.settings.getOption("direction")) {
                UIInteractions.isRunning[myName] = false;
                return resolve();
            }

            // Use cached responses when able
            let a = {
                chromaticNumber: (await GraphState.getProperty("Chromatic Number")) as number,
                colors: GraphState.state.graphColoring as {}
            };

            const printGC = () => {
                GraphState.graphProperties["Chromatic Number"] = a.chromaticNumber;
                GraphState.setUpToDate(true, ["Chromatic Number", "graphColoring"]);
                (GraphState.state.graphColoring as {}) = a.colors;

                const colors = help.flatten(a.colors);
                let p = `Number of Vertices: ${colors.length}`;
                p += `\nChromatic Number: ${a.chromaticNumber}`;
                p += "\n\n";

                colors.forEach((v, i) => {
                    p += `Vertex ${GraphState.nodeIDToLabel(i)} gets color ${v}\n`;
                });

                p += `\n${JSON.stringify(help.rotate(a.colors), null, 4)}\n\n`;

                p = `<h3>Graph Coloring Using Welsh-Powell Algorithm</h3><hr>${help.htmlEncode(p)}`;
                p +=
                    "<br/><button class='btn btn-primary' onclick='main.applyColors()'>Apply New Colors To Graph</button>";

                help.printout(p);
                window.main.applyColors();
            };

            const iStartedProgress = UIInteractions.startLoadingAnimation();

            if (!(a.chromaticNumber !== null && (await GraphState.getProperty("graphColoring")) !== null)) {
                const w = UIInteractions.getWorkerIfPossible(e => {
                    a = e.data;
                    printGC();
                    w.cleanup();
                    if (iStartedProgress) {
                        UIInteractions.stopLoadingAnimation();
                    }
                    UIInteractions.isRunning[myName] = false;
                    resolve(e.data);
                });
                w.send({
                    type: "colorNetwork",
                    args: [],
                    graph: window.main.graphState.getGraphData(),
                    convertToGraphImmut: true
                });
            } else {
                printGC();
                if (iStartedProgress) {
                    UIInteractions.stopLoadingAnimation();
                }
            }
        });
    }

    static makeAndPrintDirectionalEulerian(): Promise<void> {
        const myName = "Eulerian";
        if (UIInteractions.isRunning[myName]) {
            UIInteractions.printAlreadyRunning(myName);
            return Promise.reject("Already Running");
        }
        UIInteractions.isRunning[myName] = true;

        return new Promise<void>(async resolve => {
            if (!window.settings.getOption("direction")) {
                UIInteractions.isRunning[myName] = false;
                return resolve();
            }

            const iStartedProgress = UIInteractions.startLoadingAnimation();
            const w = UIInteractions.getWorkerIfPossible(e => {
                GraphState.graphProperties.eulerian = e.data;
                GraphState.setUpToDate(true, ["eulerian"]);
                w.cleanup();
                if (iStartedProgress) {
                    UIInteractions.stopLoadingAnimation();
                }
                UIInteractions.isRunning[myName] = false;
                resolve(e.data);
            });

            const scc = await GraphState.getProperty("stronglyConnectedComponents", true);

            w.send({
                type: "directionalEulerian",
                args: [gHelp.findVertexDegreesDirectional(GraphState.graph.getFullAdjacency()), scc]
            });
        });
    }

    static makeAndPrintEulerian(ignoreDuplicate = false): Promise<void> {
        const myName = "Eulerian";
        if (UIInteractions.isRunning[myName]) {
            if (ignoreDuplicate) {
                return Promise.resolve();
            }
            UIInteractions.printAlreadyRunning(myName);
            return Promise.reject("Already Running");
        }
        UIInteractions.isRunning[myName] = true;

        return new Promise<void>(async resolve => {
            if (window.settings.getOption("direction")) {
                UIInteractions.isRunning[myName] = false;
                return resolve(UIInteractions.makeAndPrintDirectionalEulerian());
            }

            const iStartedProgress = UIInteractions.startLoadingAnimation();
            const cc = await GraphState.getProperty("connectedComponents", true);

            const w = UIInteractions.getWorkerIfPossible(e => {
                GraphState.graphProperties.eulerian = e.data;
                GraphState.setUpToDate(true, ["eulerian"]);
                if (iStartedProgress) {
                    UIInteractions.stopLoadingAnimation();
                }
                UIInteractions.isRunning[myName] = false;
                w.cleanup();
                resolve(e.data);
            });
            w.send({
                type: "hasEulerianCircuit",
                args: [GraphState.graph.getAllOutDegrees(), cc]
            });
        });
    }

    static makeAndPrintFFMCMF(): void {
        if (!window.settings.getOption("direction") || !window.settings.getOption("weights")) {
            return;
        }
        const myName = "Ford-Fulkerson";
        if (UIInteractions.isRunning[myName]) {
            UIInteractions.printAlreadyRunning(myName);
            return;
        }
        UIInteractions.isRunning[myName] = true;

        help.showFormModal(
            async ($modal, values) => {
                $modal.modal("hide");

                const source = GraphState.nodeLabelToID(values[0]);
                const sink = GraphState.nodeLabelToID(values[1]);

                let a: boolean | FlowResult | null = null;

                const cb = () => {
                    let p = `<h3>Ford-Fulkerson</h3><hr>No path exists from `;
                    p += `${help.htmlEncode(GraphState.nodeIDToLabel(source))} to ${help.htmlEncode(
                        GraphState.nodeIDToLabel(sink)
                    )}`;

                    if (a === false) {
                        help.printout(p);
                        return;
                    }
                    a = a as { maxFlow: number; flowPath: any[] };

                    p = `Ford-Fulkerson MaxFlow-MinCut Max Flow From ${GraphState.nodeIDToLabel(source)} `;
                    p += `to ${GraphState.nodeIDToLabel(sink)}: ${a.maxFlow}`;
                    p += "\n\nUsing Capacities:\n\n";
                    p = help.htmlEncode(p);
                    a.flowPath.forEach(v => {
                        p += `${GraphState.nodeIDToLabel(v.from)}&rarr;${GraphState.nodeIDToLabel(v.to)} using ${
                            v.flow
                        } of ${v.capacity}\n`;
                    });
                    p = p.trim();
                    p = "<h3>Ford-Fulkerson MaxFlow-MinCut</h3><hr>" + p;

                    help.printout(p);
                };

                const iStartedProgress = UIInteractions.startLoadingAnimation();
                const w = UIInteractions.getWorkerIfPossible(e => {
                    a = e.data;
                    UIInteractions.isRunning[myName] = false;
                    cb();
                    if (iStartedProgress) {
                        UIInteractions.stopLoadingAnimation();
                    }
                    w.cleanup();
                });
                w.send({
                    type: "fordFulkerson",
                    args: [source, sink],
                    convertToGraphImmut: true,
                    graph: window.main.graphState.getGraphData()
                });
            },
            "Ford-Fulkerson MaxFlow-MinCut",
            "Go",
            [
                {
                    label: "Source Node",
                    type: "text",
                    validationFunc: window.main.nodeLabelIDValidator
                },
                {
                    label: "Sink Node",
                    type: "text",
                    validationFunc: window.main.nodeLabelIDValidator
                }
            ]
        );
    }

    static makeAndPrintKruskal(): void {
        if (window.settings.getOption("direction") || !window.settings.getOption("weights")) {
            return;
        }

        const myName = "Kruskal";
        if (UIInteractions.isRunning[myName]) {
            UIInteractions.printAlreadyRunning(myName);
            return;
        }
        UIInteractions.isRunning[myName] = true;

        const iStartedProgress = UIInteractions.startLoadingAnimation();
        const w = UIInteractions.getWorkerIfPossible(e => {
            const a: MSTResult = e.data;
            w.cleanup();

            let p = `Kruskal's Minimum Spanning Tree Total Weight: ${a.totalWeight}`;
            p += "\n\nUsing Edges:\n\n";
            p = help.htmlEncode(p);
            a.mst.forEach(v => {
                p += `${GraphState.nodeIDToLabel(new EdgeImmut(v).getFrom())}&rarr;`;
                p += `${GraphState.nodeIDToLabel(new EdgeImmut(v).getTo())}\n`;
            });
            p = p.trim();
            p = `<h3>Kruskal Minimum Spanning Tree</h3><hr>${p}`;

            if (iStartedProgress) {
                UIInteractions.stopLoadingAnimation();
            }
            UIInteractions.isRunning[myName] = false;

            help.printout(p);
        });
        w.send({
            type: "kruskal",
            args: [],
            convertToGraphImmut: true,
            graph: window.main.graphState.getGraphData()
        });
    }

    static makeAndPrintIsCyclic(): Promise<void> {
        if (!window.settings.getOption("direction")) {
            return Promise.resolve();
        }

        const myName = "Cyclic";
        if (UIInteractions.isRunning[myName]) {
            UIInteractions.printAlreadyRunning(myName);
            return Promise.reject("Already Running");
        }
        UIInteractions.isRunning[myName] = true;

        return new Promise<void>(resolve => {
            const iStartedProgress = UIInteractions.startLoadingAnimation();
            const w = UIInteractions.getWorkerIfPossible(e => {
                GraphState.graphProperties.cyclic = e.data;
                GraphState.setUpToDate(true, ["cyclic"]);
                w.cleanup();
                if (iStartedProgress) {
                    UIInteractions.stopLoadingAnimation();
                }
                UIInteractions.isRunning[myName] = false;
                resolve();
            });
            w.send({
                type: "isGraphCyclic",
                args: [],
                convertToGraphImmut: true,
                graph: window.main.graphState.getGraphData()
            });
        });
    }

    static makeAndPrintTopologicalSort(): void {
        if (!window.settings.getOption("direction")) {
            return;
        }

        const myName = "Topological Sort";
        if (UIInteractions.isRunning[myName]) {
            UIInteractions.printAlreadyRunning(myName);
            return;
        }
        UIInteractions.isRunning[myName] = true;

        const iStartedProgress = UIInteractions.startLoadingAnimation();
        const w = UIInteractions.getWorkerIfPossible(e => {
            const a: boolean | NodeImmut[] = e.data;
            w.cleanup();

            if (iStartedProgress) {
                UIInteractions.stopLoadingAnimation();
            }
            UIInteractions.isRunning[myName] = false;

            if (a === true) {
                GraphState.graphProperties.cyclic = true;
                GraphState.setUpToDate(true, ["cyclic"]);
                help.printout(
                    "<h3>Topological Sorting Failed</h3><hr>Topological sorting failed because the graph contains a cycle"
                );

                return;
            }

            let p = "Topological Sorting:\n\n";
            p = help.htmlEncode(p);
            (a as any[]).forEach(v => {
                p += `${GraphState.nodeIDToLabel(v.id)}, `;
            });
            p = p.slice(0, -2);
            p = `<h3>Topological Sorting</h3><hr>${p}`;

            help.printout(p);
        });
        w.send({
            type: "topologicalSort",
            args: [],
            convertToGraphImmut: true,
            graph: window.main.graphState.getGraphData()
        });
    }

    static printGraphAlgorithms(): void {
        const $div = document.getElementById("algorithms-pane")!;
        $div.innerHTML = "";
        const directional = window.settings.getOption("direction");
        const weighted = window.settings.getOption("weights");

        const addAlgoToPane = (alg: AlgorithmI) => {
            const navlink = document.createElement("a");
            navlink.classList.add("nav-link");
            navlink.setAttribute("href", "#");
            navlink.innerText = alg.name;
            navlink.addEventListener("click", e => {
                e.preventDefault();
                alg.applyFunc();
            });

            $div.appendChild(navlink);
        };

        const a = UIInteractions.getAlgorithms();
        a.forEach(alg => {
            if (!alg.display) {
                return;
            }
            if (("directional" in alg && alg.directional === directional) || !("directional" in alg)) {
                if (("weighted" in alg && alg.weighted === weighted) || !("weighted" in alg)) {
                    addAlgoToPane(alg);
                }
            } else if (("weighted" in alg && alg.weighted === weighted) || !("weighted" in alg)) {
                if (("directional" in alg && alg.directional === directional) || !("directional" in alg)) {
                    addAlgoToPane(alg);
                }
            }
        });
    }
}
