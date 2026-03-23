/// <reference path="../../lib/data.d.ts" />
/// <reference path="../../lib/util.d.ts" />
/// <reference path="ccs.ts" />

module Traverse {

    import ccs = CCS;

    export class ProcessTreeReducer implements ccs.ProcessVisitor<ccs.Process>, ccs.ProcessDispatchHandler<ccs.Process> {
        protected cache : {[id : number] : ccs.Process} = Object.create(null);

        constructor(public graph : ccs.Graph) {
        }

        visit(process : ccs.Process) : ccs.Process {
            return process.dispatchOn(this);
        }

        dispatchNullProcess(process : ccs.NullProcess) {
            var resultProcess = this.cache[process.id];
            if (!resultProcess) {
                resultProcess = this.cache[process.id] = process;
            }
            return resultProcess;
        }

        dispatchNamedProcess(process : ccs.NamedProcess) {
            return process;
        }

        dispatchSummationProcess(process : ccs.SummationProcess) {
            var resultProcess = this.cache[process.id];
            if (!resultProcess) {
                var subProcesses : Array<CCS.Process> = process.subProcesses.map(subProc => subProc.dispatchOn(this));
                subProcesses = subProcesses.filter(subProc => !(subProc instanceof ccs.NullProcess));
                subProcesses = ArrayUtil.sortAndRemoveDuplicates(subProcesses, p => p.id);
                if (subProcesses.length === 0) {
                    return this.graph.getNullProcess();
                }
                if (subProcesses.length === 1) {
                    return subProcesses[0];
                }
                resultProcess = this.cache[process.id] = this.graph.newSummationProcess(subProcesses);
            }
            return resultProcess;
        }

        dispatchCompositionProcess(process : ccs.CompositionProcess) {
            var resultProcess = this.cache[process.id];
            if (!resultProcess) {
                var subProcesses = process.subProcesses.map(subProc => subProc.dispatchOn(this));
                subProcesses = subProcesses.filter(subProc => !(subProc instanceof ccs.NullProcess));
                if (subProcesses.length === 0) {
                    return this.graph.getNullProcess();
                }
                if (subProcesses.length === 1) {
                    return subProcesses[0];
                }
                resultProcess = this.cache[process.id] = this.graph.newCompositionProcess(subProcesses);
            }
            return resultProcess;
        }

        dispatchActionPrefixProcess(process : ccs.ActionPrefixProcess) {
            var resultProcess = this.cache[process.id];
            if (!resultProcess) {
                var nextProcess = process.nextProcess.dispatchOn(this);
                resultProcess = this.cache[process.id] = this.graph.newActionPrefixProcess(process.action, nextProcess);
            }
            return resultProcess;
        }

        dispatchRestrictionProcess(process : ccs.RestrictionProcess) {
            var resultProcess = this.cache[process.id];
            if (!resultProcess) {
                var subProcess = process.subProcess.dispatchOn(this);
                var tempProcess;
                // (P \ L1) \L2 => P \ (L1 Union L2)
                if (subProcess instanceof ccs.RestrictionProcess) {
                    var subRestriction = <ccs.RestrictionProcess>subProcess;
                    var mergedLabels = subRestriction.restrictedLabels.union(process.restrictedLabels);
                    tempProcess = this.graph.newRestrictedProcess(subRestriction.subProcess, mergedLabels);
                } else {
                    tempProcess = this.graph.newRestrictedProcess(subProcess, process.restrictedLabels);
                }
                // 0 \ L => 0
                if (tempProcess.subProcess instanceof ccs.NullProcess) {
                    return tempProcess.subProcess;
                }
                // P \ Ø => P
                if (tempProcess.restrictedLabels.empty()) {
                    return tempProcess.subProcess;
                }
                resultProcess = this.cache[process.id] = tempProcess;
            }
            return resultProcess;
        }

        dispatchRelabellingProcess(process : ccs.RelabellingProcess) {
            var resultProcess = this.cache[process.id];
            if (!resultProcess) {
                const subProcess = process.subProcess.dispatchOn(this);
                if (subProcess instanceof ccs.NullProcess) return subProcess; // 0 [f] => 0
                if (subProcess instanceof ccs.RelabellingProcess) { // P [f1] [f2] => P [f2 . f1]
                    const newRelabels = ccs.RelabellingSet.FromComposition(subProcess.relabellings, process.relabellings);
                    resultProcess = this.graph.newRelabelingProcess(subProcess.subProcess, newRelabels);
                } else {
                    resultProcess = this.graph.newRelabelingProcess(subProcess, process.relabellings);
                }
                if (resultProcess.relabellings.isEmpty()) { // P [] => P
                    resultProcess = resultProcess.subProcess;
                }
                this.cache[process.id] = resultProcess;
            }
            return resultProcess;
        }
    }

    class AbstractTransition {
        constructor(public fromId : ccs.ProcessId, public action : ccs.Action, public toId : ccs.ProcessId) {
        }
    }

    class FromData {
        constructor(public prev : FromData, public action : ccs.Action, public to : ccs.Process) {
        }
    }

    function compareAction(left : ccs.Action, right : ccs.Action) : number {
        if (left.isComplement() !== right.isComplement()) return <any>left.isComplement() - <any>right.isComplement();
        if (left.getLabel() < right.getLabel()) return -1;
        if (right.getLabel() < left.getLabel()) return 1;
        return 0;
    }

    function compareTransitionTuple(left : AbstractTransition, right : AbstractTransition) : number {
        var fromIdDiff = left.fromId.localeCompare(right.fromId);
        if (fromIdDiff !== 0) return fromIdDiff;
        var toIdDiff = left.toId.localeCompare(right.toId);
        if (toIdDiff !== 0) return toIdDiff;
        return compareAction(left.action, right.action);
    }

    export class AbstractingSuccessorGenerator implements ccs.SuccessorGenerator {
        getCollapse?: () => Traverse.Collapse;

        setBisimilarityCollapse(getCollapse: () => Traverse.Collapse) {
            this.getCollapse = getCollapse;
        }

        private abstractions : ccs.Action[];
        public strictSuccGenerator : ccs.SuccessorGenerator;
        public cache;
        
        private fromTable : MapUtil.Map<AbstractTransition, FromData> =
                new MapUtil.OrderedMap<AbstractTransition, FromData>(compareTransitionTuple);

        constructor(abstractions : ccs.Action[], strictSuccGenerator : ccs.SuccessorGenerator, cache?) {
            this.abstractions = abstractions;
            this.strictSuccGenerator = strictSuccGenerator;
            this.cache = cache || {};
        }

        public getAbstractions() : ccs.Action[] {
            return this.abstractions;
        }

        getGraph() {
            return this.strictSuccGenerator.getGraph();
        }

        getProcessByName(processName : string) : ccs.Process {
            return this.strictSuccGenerator.getProcessByName(processName);
        }

        getProcessById(processId : ccs.ProcessId) : ccs.Process { 
            return this.strictSuccGenerator.getProcessById(processId);
        }

        getSuccessors(sourceProcessId : ccs.ProcessId) : ccs.TransitionSet {
            if (this.cache[sourceProcessId]) return this.cache[sourceProcessId];

            var result = new ccs.TransitionSet();
            var sourceProcess = this.strictSuccGenerator.getProcessById(sourceProcessId);
            var stage1Processes = [];
            var stage2Processes = [];

            var isAbstraction = (action) => {
                return this.abstractions.some(abstraction => abstraction.equals(action));
            };

            // Precondition: there must be non abstraction
            var findNonAbstraction = (fromData) => {
                if (isAbstraction(fromData.action)) return findNonAbstraction(fromData.prev);
                return fromData.action;
            };

            var addTransitions = (
                    prevFromData : FromData,
                    fromProcess : ccs.Process,
                    isStageTwo : boolean) => {
                var strongSuccessors = this.strictSuccGenerator.getSuccessors(fromProcess.id);
                strongSuccessors.forEach(transition => {
                    var isActionAbstract = isAbstraction(transition.action);
                    //No loops yet with abstractions
                    if (!isActionAbstract || fromProcess.id !== transition.targetProcess.id) {       
                        var targetId = transition.targetProcess.id;
                        var newFromData = new FromData(prevFromData, transition.action, transition.targetProcess);
                        if (!isStageTwo) {
                            if (isActionAbstract) { // ...  --1/tau--> X
                                this.abstractions.forEach(abstraction => {
                                    this.fromTable.set(new AbstractTransition(sourceProcessId, abstraction, targetId), newFromData);
                                });
                                stage1Processes.push(newFromData);
                            } else {  // ... --a--> X
                                this.fromTable.set(new AbstractTransition(sourceProcessId, transition.action, targetId), newFromData);
                                stage2Processes.push(newFromData);
                            }
                        } else if (isActionAbstract) { // --a--> ....  --1/tau-> X
                            var nonAbstractAction = findNonAbstraction(prevFromData);
                            this.fromTable.set(new AbstractTransition(sourceProcessId, nonAbstractAction, targetId), newFromData);
                            stage2Processes.push(newFromData);
                        }
                    }
                });
            };

            //Abstraction does not matter in this call since stage two is false.
            addTransitions(null, sourceProcess, false);

            //Stage 1
            //Find all --tau-->* and
            //     all --tau-->*  --x-->
            while (stage1Processes.length > 0) {
                var fromData = stage1Processes.pop();
                //  P == action ==> Q
                var transition = new CCS.Transition(fromData.action, fromData.to);
                if (!result.contains(transition)) {
                    //Know only abstracts in this loop.
                    //If  --1--> X then also --tau--> X and reverse
                    this.abstractions.forEach(abstraction => {
                        result.add(new CCS.Transition(abstraction, fromData.to));
                    });
                    addTransitions(fromData, fromData.to, false);
                }
            }

            //Stage 2
            //Find all continuing  P --tau-->* when already --tau->* --x--> P
            while (stage2Processes.length > 0) {
                var fromData = stage2Processes.pop();
                var nonAbstractAction = findNonAbstraction(fromData);
                var transition = new CCS.Transition(nonAbstractAction, fromData.to);
                if (!result.contains(transition)) {
                    result.add(transition);
                    addTransitions(fromData, fromData.to, true);
                }
            }

            //Add tau loop to from set:  P ==tau=> P, by P -- tau -> P
            this.abstractions.forEach(abstraction => {
                var abstractTransition = new AbstractTransition(sourceProcessId, abstraction, sourceProcessId);
                if (!this.fromTable.has(abstractTransition)) {
                    var fromData = new FromData(null, abstraction, sourceProcess);
                    this.fromTable.set(abstractTransition, fromData);
                }
                result.add(new CCS.Transition(abstraction, sourceProcess));
            });

            this.cache[sourceProcessId] = result;
            return result;
        }

        //Only call with arguments, for which getSuccessors(fromId) has yielded Transition(action, proces.toId)
        getStrictPath(fromId : ccs.ProcessId, action : ccs.Action, toId : ccs.ProcessId) : ccs.Transition[] {
            var transitions = [],
                succGen = this.strictSuccGenerator;
            var fromData = this.fromTable.get(new AbstractTransition(fromId, action, toId));
            if (!fromData) throw "Do not call getStrictPath with unknown data.";
            do {
                transitions.push(new ccs.Transition(fromData.action, fromData.to));
                fromData = fromData.prev;
            } while (fromData);
            transitions.reverse();
            return transitions;
        }
    }
    
    export class WeakSuccessorGenerator extends AbstractingSuccessorGenerator {
        
        constructor(strictSuccGenerator : ccs.SuccessorGenerator, cache?) {
            super([new ccs.Action("tau", false)], strictSuccGenerator, cache);
        }
    }

    export class ReducingSuccessorGenerator implements ccs.SuccessorGenerator {
        getCollapse?: () => Traverse.Collapse;

        setBisimilarityCollapse(getCollapse: () => Traverse.Collapse) {
            this.getCollapse = getCollapse;
        }

        constructor(public succGenerator : ccs.SuccessorGenerator, public reducer : ProcessTreeReducer) { }

        getGraph() {
            return this.succGenerator.getGraph();
        }

        getProcessByName(processName : string) : ccs.Process {
            var namedProcess = this.succGenerator.getProcessByName(processName);
            return this.reducer.visit(namedProcess);
        }

        getProcessById(processId : ccs.ProcessId) : ccs.Process {
            var proc = this.succGenerator.getProcessById(processId);
            return this.reducer.visit(proc);
        }

        getSuccessors(processId : ccs.ProcessId) : ccs.TransitionSet {
            var transitionSet = this.succGenerator.getSuccessors(processId);
            return this.reduceSuccessors(transitionSet);
        }

        private reduceSuccessors(transitionSet : ccs.TransitionSet) {
            var result = new ccs.TransitionSet();
            transitionSet.forEach(transition => {
                result.add(new ccs.Transition(transition.action, this.reducer.visit(transition.targetProcess)));
            });
            return result;
        }
    }

    export class NoRedundancySuccessorGenerator implements ccs.SuccessorGenerator {
        getCollapse?: () => Traverse.Collapse;    

        setBisimilarityCollapse(getCollapse: () => Traverse.Collapse) {
            this.getCollapse = getCollapse;
        }

        constructor(public succGenerator : ccs.SuccessorGenerator, public reducer : ProcessTreeReducer) {}

        getGraph() {
            return this.succGenerator.getGraph();
        }

        getProcessByName(processName : string) : ccs.Process {
            var namedProcess = this.succGenerator.getProcessByName(processName);
            return this.reducer.visit(namedProcess);
        }

        getProcessById(processId : ccs.ProcessId) : ccs.Process {
            var proc = this.succGenerator.getProcessById(processId);
            return this.reducer.visit(proc);
        }

        getNormalFormFromProcess(process: ccs.Process): ccs.Process {
            var getSubProcessesInNormalForm = <T extends { subProcesses: ccs.Process[] }>(process: T) => {
                var newSubProcesses: ccs.Process[] = [];

                // Change all subprocesses to normal form
                process.subProcesses.forEach((subProcess) => {
                    var normalFormSubProcess = this.getNormalFormFromProcess(subProcess);
                    newSubProcesses.push(normalFormSubProcess);
                });
                
                return newSubProcesses;
            };

            var normalFormProcess: ccs.Process = process;
            if (process instanceof ccs.SummationProcess) {
                var normalFormSubprocesses: ccs.Process[] = getSubProcessesInNormalForm(process);

                var newSubProcesses: ccs.Process[] = [];
                normalFormSubprocesses.forEach(subProcess => {
                    // Null element: P + 0 => P
                    if (subProcess instanceof ccs.NullProcess) {
                        return;
                    }
                    // Flatten: P + (Q + R) => P + Q + R
                    else if (subProcess instanceof ccs.SummationProcess) {
                        subProcess.subProcesses.forEach(nested => {
                            // Idempotence: P + P => P, also for nested processes
                            if (newSubProcesses.indexOf(nested) === -1) {
                                newSubProcesses.push(nested);
                            }
                        });
                    }
                    // Idempotence: P + P => P
                    else if (newSubProcesses.indexOf(subProcess) > -1) { //Includes
                        return;
                    }
                    else {
                        newSubProcesses.push(subProcess);
                    }
                });
                // Symmetry: P + Q => Q + P, order by id
                newSubProcesses.sort();
                normalFormProcess = new ccs.SummationProcess(newSubProcesses);
            }
            else if (process instanceof ccs.ActionPrefixProcess) {
                normalFormProcess = new ccs.ActionPrefixProcess(process.action, this.getNormalFormFromProcess(process.nextProcess));
            }
            else if (process instanceof ccs.CompositionProcess) {
                var normalFormSubprocesses: ccs.Process[] = getSubProcessesInNormalForm(process);

                var newSubProcesses: ccs.Process[] = [];
                normalFormSubprocesses.forEach(subProcess => {
                    // Null element: P | 0 => P
                    if (subProcess instanceof ccs.NullProcess) {
                        return;
                    }
                    // Flatten: P | (Q | R) => P | Q | R
                    else if (subProcess instanceof ccs.CompositionProcess) {
                        subProcess.subProcesses.forEach(nested => {
                            newSubProcesses.push(nested);
                        });
                    }
                    // Idempotence is not valid when compositions synchronize
                    else {
                        newSubProcesses.push(subProcess);
                    }
                });
                // Symmetry: P | Q => Q | P, order by id
                newSubProcesses.sort();
                normalFormProcess = new ccs.SummationProcess(newSubProcesses);
            }
            else if (process instanceof ccs.RelabellingProcess) {
                // TODO: Take a deeper look at this later
                normalFormProcess = new ccs.RelabellingProcess(this.getNormalFormFromProcess(process), process.relabellings);
            }
            else if (process instanceof ccs.RestrictionProcess) {
                // TODO: Take a deeper look at this later
                normalFormProcess = new ccs.RestrictionProcess(this.getNormalFormFromProcess(process), process.restrictedLabels);
            }
            else if (process instanceof ccs.NamedProcess) {
                // 🙏🙏 Nothing to rewrite
            }
            else if (process instanceof ccs.NullProcess) {
                // 🙏🙏 Nothing to rewrite
            }

            return normalFormProcess;
        }
        
        getSuccessors(processId : ccs.ProcessId) : ccs.TransitionSet {
            var successors = new ccs.TransitionSet();
            var transitions: ccs.TransitionSet = this.succGenerator.getSuccessors(processId);
            // For each possible transition from the process, get normal form
            transitions.forEach((transition) => {
                const normalFormTargetProcess = this.getNormalFormFromProcess(transition.targetProcess);
                successors.add(new ccs.Transition(transition.action, normalFormTargetProcess));
            });
            return successors;
        }
    }

    export function reduceProcess(process: ccs.Process): ccs.Process {
        const reducer = new ProcessReducer();
        return process.dispatchOn(reducer);
    }

    class ProcessReducer implements ccs.ProcessDispatchHandler<ccs.Process> {

    dispatchNullProcess(process: ccs.NullProcess): ccs.Process {
        return process;
    }

    dispatchNamedProcess(process: ccs.NamedProcess): ccs.Process {
        const reduced = process.subProcess.dispatchOn(this);

        // A ≡ P if it is just a wrapper
        if (reduced.id === process.name) return reduced;

        return new ccs.NamedProcess(process.name, reduced);
    }

    dispatchSummationProcess(process: ccs.SummationProcess): ccs.Process {
        const flattened: ccs.Process[] = [];

        for (const p of process.subProcesses) {
            const r = p.dispatchOn(this);

            if (r instanceof ccs.NullProcess) continue;

            if (r instanceof ccs.SummationProcess) {
                flattened.push(...r.subProcesses);
            } else {
                flattened.push(r);
            }
        }

        const unique = uniqueProcesses(flattened);

        if (unique.length === 0) return new ccs.NullProcess();
        if (unique.length === 1) return unique[0];

        return new ccs.SummationProcess(unique);
    }

    dispatchCompositionProcess(process: ccs.CompositionProcess): ccs.Process {
        const flattened: ccs.Process[] = [];

        for (const p of process.subProcesses) {
            const r = p.dispatchOn(this);

            if (r instanceof ccs.NullProcess) continue;

            if (r instanceof ccs.CompositionProcess) {
                flattened.push(...r.subProcesses);
            } else {
                flattened.push(r);
            }
        }

        if (flattened.length === 0) return new ccs.NullProcess();
        if (flattened.length === 1) return flattened[0];

        return new ccs.CompositionProcess(flattened);
    }

    dispatchActionPrefixProcess(process: ccs.ActionPrefixProcess): ccs.Process {
        const next = process.nextProcess.dispatchOn(this);

        return new ccs.ActionPrefixProcess(process.action, next);
    }

    dispatchRestrictionProcess(process: ccs.RestrictionProcess): ccs.Process {
        const sub = process.subProcess.dispatchOn(this);

        if (sub instanceof ccs.NullProcess) {
            return sub;
        }

        return new ccs.RestrictionProcess(sub, process.restrictedLabels);
    }

    dispatchRelabellingProcess(process: ccs.RelabellingProcess): ccs.Process {
        const sub = process.subProcess.dispatchOn(this);

        if (sub instanceof ccs.NullProcess) {
            return sub;
        }

        return new ccs.RelabellingProcess(sub, process.relabellings);
    }
    }

    function uniqueProcesses(processes: ccs.Process[]): ccs.Process[] {
    const seen: { [id: string]: ccs.Process } = {};

    for (let i = 0; i < processes.length; i++) {
        const p = processes[i];
        seen[p.id] = p;
    }

    const result: ccs.Process[] = [];

    for (const k in seen) {
        if (seen.hasOwnProperty(k)) {
            result.push(seen[k]);
        }
    }

    return result;
}
}
