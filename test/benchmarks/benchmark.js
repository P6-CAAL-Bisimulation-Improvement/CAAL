
var tvs = Traverse,
    dgMod = DependencyGraph,
    ccs = CCS,
    hml = HML;

function getStrictSuccGenerator(graph) {
    return CCS.getSuccGenerator(graph, {succGen: "strong", reduce: true});
}

function getWeakSuccGenerator(graph) {
    return CCS.getSuccGenerator(graph, {succGen: "weak", reduce: true});
}

var program = "* Sender\n" +
    "agent Send0 = acc.Sending0;\n" +
    "agent Sending0 = 'left0.Sending0 + leftAck0.Send1 + leftAck1.Sending0;\n" +
    "agent Send1 = acc.Sending1;\n" +
    "agent Sending1 = 'left1.Sending1 + leftAck1.Send0 + leftAck0.Sending1;\n" +
    "\n" +
    "* Receiver\n" +
    "agent Received0 = 'del.RecvAck1;\n" +
    "agent Received1 = 'del.RecvAck0;\n" +
    "agent RecvAck0 = right0.Received0 + right1.RecvAck0 + 'rightAck1.RecvAck0;\n" +
    "agent RecvAck1 = right1.Received1 + right0.RecvAck1 + 'rightAck0.RecvAck1;\n" +
    "\n" +
    "* Medium\n" +
    "agent Med = MedTop | MedBot;\n" +
    "agent MedBot = left0.MedBotRep0 + left1.MedBotRep1;\n" +
    "agent MedBotRep0 = 'right0.MedBotRep0 + MedBot;\n" + //Removed tau
    "agent MedBotRep1 = 'right1.MedBotRep1 + MedBot;\n" + //Removed tau
    "agent MedTop = rightAck0.MedTopRep0 + rightAck1.MedTopRep1;\n" +
    "agent MedTopRep0 = 'leftAck0.MedTopRep0 + MedTop;\n" + //Removed tau
    "agent MedTopRep1 = 'leftAck1.MedTopRep1 + MedTop;\n" + //Removed tau
    "\n" +
    "* Protocol and specification\n" +
    "set InternalComActs = {left0, left1, right0, right1, leftAck0, leftAck1, rightAck0, rightAck1};\n" +
    "agent Protocol = (Send0 | Med | RecvAck0) \\ InternalComActs;\n" +
    "agent Spec = acc.'del.Spec;";

function bisimulation(graph) {
    var succGen = getStrictSuccGenerator(graph),
        defendSuccGen = getWeakSuccGenerator(graph),
        protocol = graph.processByName("Protocol").id,
        spec = graph.processByName("Spec").id;
    isBisimilar = Equivalence.isBisimilar(succGen, defendSuccGen, protocol, spec, graph);
};

var benchParsing = new Benchmark("Parsing", function () {
    CCSParser.parse(program, {ccs: ccs});
});

var benchBisim = new Benchmark("Strong Bisimulation", function () {
    bisimulation(graph);
}, {
    'setup': function () {
        var graph = CCSParser.parse(program, {ccs: ccs});
    },
    minSamples: 100,
    maxTime: 0
});

var suite = new Benchmark.Suite();

suite
    .add(benchParsing)
    .add(benchBisim)
    .on('cycle', function (event) {
        onBenchmarkResult(event.target);
    })
    .on('complete', function () {
        onBenchmarkSuiteComplete(this);
    })
    .run({'async': true});
