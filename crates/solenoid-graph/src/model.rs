// [[C130]] rustCore
//! The graph model: a Ruggine editor whose nodes are classic nodes (ports and their socket types)
//! beside the host's own node object, its cables, the signals it sends the host's pipes, and the
//! dataflow engine attached to it (`tree/specs/computation/graph-core.md` § The model).

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use ruggine::classic::{self, ClassicConnection, ClassicNode, Input, Output, Socket};
use ruggine::future::{now_or_never, LocalBoxFuture};
use ruggine::{ConnectionBase, GetSchemes, NodeBase, NodeEditor, PipeId, Plugin, Root};
use ruggine_engine::{DataflowEngine, DataflowNode, Error, Inputs, Outputs};

/// What the host keeps beside the model: its node and cable objects, the values its nodes
/// compute, what its pipes throw, and how a node computes.
pub trait Host: 'static {
    type Node: 'static;
    type Connection: 'static;
    type Value: Clone + 'static;
    type Thrown: 'static;

    /// Computes the node; `ports` are its ports as the editor holds them.
    fn data<'a>(
        node: &'a Self::Node,
        ports: &'a classic::Node,
        inputs: Inputs<Self::Value>,
    ) -> LocalBoxFuture<'a, Result<Outputs<Self::Value>, Error>>;
}

/// A node: its ports, as a classic node, and the host's object.
pub struct GraphNode<H: Host> {
    pub classic: classic::Node,
    pub object: H::Node,
}

impl<H: Host> NodeBase for GraphNode<H> {
    fn id(&self) -> &str {
        &self.classic.id
    }
}

impl<H: Host> ClassicNode for GraphNode<H> {
    type Socket = Socket;

    fn classic(&self) -> &classic::Node {
        &self.classic
    }
}

impl<H: Host> DataflowNode<H::Value> for GraphNode<H> {
    fn data(
        &self,
        inputs: Inputs<H::Value>,
    ) -> LocalBoxFuture<'_, Result<Outputs<H::Value>, Error>> {
        H::data(&self.object, &self.classic, inputs)
    }
}

/// A cable and the host's object for it.
pub struct GraphConnection<H: Host> {
    classic: classic::Connection,
    pub object: H::Connection,
}

impl<H: Host> ConnectionBase for GraphConnection<H> {
    fn id(&self) -> &str {
        &self.classic.id
    }

    fn source(&self) -> &str {
        &self.classic.source
    }

    fn target(&self) -> &str {
        &self.classic.target
    }
}

impl<H: Host> ClassicConnection for GraphConnection<H> {
    fn source_output(&self) -> &str {
        &self.classic.source_output
    }

    fn target_input(&self) -> &str {
        &self.classic.target_input
    }
}

pub type Scheme<H> = GetSchemes<GraphNode<H>, GraphConnection<H>>;
pub type Signal<H> = Root<Scheme<H>>;

/// Which side of a node a port is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Input,
    Output,
}

/// A port's key and its socket type.
pub type Port = (String, String);

/// Why an edit failed: a pipe threw, or the editor refused it.
#[derive(Debug)]
pub enum Failure<T> {
    Thrown(T),
    Graph(ruggine::Error),
}

impl<T> From<ruggine::Error> for Failure<T> {
    fn from(e: ruggine::Error) -> Self {
        Failure::Graph(e)
    }
}

/// One editor and its engine.
pub struct Graph<H: Host> {
    editor: NodeEditor<Scheme<H>>,
    engine: DataflowEngine<Scheme<H>, H::Value>,
    pipes: RefCell<Vec<Option<PipeId>>>,
    thrown: Rc<RefCell<Option<H::Thrown>>>,
    engine_used: Cell<bool>,
}

impl<H: Host> Default for Graph<H> {
    fn default() -> Self {
        Self::new()
    }
}

impl<H: Host> Graph<H> {
    pub fn new() -> Self {
        Self {
            editor: NodeEditor::new(),
            engine: DataflowEngine::new(),
            pipes: RefCell::new(Vec::new()),
            thrown: Rc::new(RefCell::new(None)),
            engine_used: Cell::new(false),
        }
    }

    pub fn editor(&self) -> &NodeEditor<Scheme<H>> {
        &self.editor
    }

    pub fn engine(&self) -> &DataflowEngine<Scheme<H>, H::Value> {
        &self.engine
    }

    /// Adds `pipe` after every pipe already there; returns the handle [`Graph::remove_pipe`] takes.
    /// The pipe answers `true` to go on with the signal and `false` to stop the chain, which
    /// cancels the change a present-tense signal announces; what it throws stops the chain and
    /// fails the edit.
    pub fn add_pipe(
        &self,
        pipe: impl Fn(&Signal<H>) -> Result<bool, H::Thrown> + 'static,
    ) -> usize {
        let thrown = self.thrown.clone();
        let id = self.editor.add_pipe(move |signal| match pipe(&signal) {
            Ok(true) => Some(signal),
            Ok(false) => None,
            Err(e) => {
                *thrown.borrow_mut() = Some(e);
                None
            }
        });
        let mut pipes = self.pipes.borrow_mut();
        pipes.push(Some(id));
        pipes.len() - 1
    }

    /// `false` when the pipe was already gone.
    pub fn remove_pipe(&self, handle: usize) -> bool {
        let id = self
            .pipes
            .borrow_mut()
            .get_mut(handle)
            .and_then(Option::take);
        id.is_some_and(|id| self.editor.remove_pipe(id))
    }

    /// Attaches the engine at this point in the chain and registers the nodes already here.
    pub fn use_engine(&self) -> Result<(), Failure<H::Thrown>> {
        if self.engine_used.replace(true) {
            return Ok(());
        }
        self.editor.use_scope(&self.engine)?;
        for node in self.editor.get_nodes() {
            let _ = now_or_never(Plugin::scope(&self.engine).emit(Root::NodeCreated(node)));
        }
        Ok(())
    }

    /// The node, as the editor holds it.
    pub fn get_node(&self, id: &str) -> Option<Rc<GraphNode<H>>> {
        self.editor.get_node(id)
    }

    pub fn engine_used(&self) -> bool {
        self.engine_used.get()
    }

    /// The edit's answer, or what a pipe threw during it.
    fn finish<T>(
        &self,
        result: Option<Result<T, ruggine::Error>>,
    ) -> Result<T, Failure<H::Thrown>> {
        if let Some(thrown) = self.thrown.borrow_mut().take() {
            return Err(Failure::Thrown(thrown));
        }
        result
            .expect("pipes are synchronous, so an edit finishes at once")
            .map_err(Failure::Graph)
    }

    /// `Ok(false)` when a `nodecreate` pipe cancelled it.
    pub fn add_node(
        &self,
        id: String,
        object: H::Node,
        inputs: &[Port],
        outputs: &[Port],
    ) -> Result<bool, Failure<H::Thrown>> {
        let mut classic = classic::Node::new("");
        classic.id = id;
        for (key, ty) in inputs {
            classic.add_input(key.clone(), Input::new(Socket::new(ty.clone())))?;
        }
        for (key, ty) in outputs {
            classic.add_output(key.clone(), Output::new(Socket::new(ty.clone())))?;
        }
        let node = Rc::new(GraphNode { classic, object });
        self.finish(now_or_never(self.editor.add_node(node)))
    }

    /// `Ok(false)` when a `noderemove` pipe cancelled it.
    pub fn remove_node(&self, id: &str) -> Result<bool, Failure<H::Thrown>> {
        self.finish(now_or_never(self.editor.remove_node(id)))
    }

    /// `Ok(false)` when a `connectioncreate` pipe cancelled it.
    pub fn add_connection(
        &self,
        connection: classic::Connection,
        object: H::Connection,
    ) -> Result<bool, Failure<H::Thrown>> {
        let connection = Rc::new(GraphConnection {
            classic: connection,
            object,
        });
        self.finish(now_or_never(self.editor.add_connection(connection)))
    }

    /// `Ok(false)` when a `connectionremove` pipe cancelled it.
    pub fn remove_connection(&self, id: &str) -> Result<bool, Failure<H::Thrown>> {
        self.finish(now_or_never(self.editor.remove_connection(id)))
    }

    /// `Ok(false)` when a `clear` pipe cancelled it.
    pub fn clear(&self) -> Result<bool, Failure<H::Thrown>> {
        self.finish(now_or_never(self.editor.clear()))
    }

    fn node(&self, id: &str) -> Result<Rc<GraphNode<H>>, ruggine::Error> {
        self.editor.get_node(id).ok_or(ruggine::Error::NodeNotFound)
    }

    /// Gives a node in the editor exactly these ports, in this order: one call for every port a change to the node
    /// made. A side already as given is left alone.
    pub fn set_ports(
        &self,
        id: &str,
        inputs: &[Port],
        outputs: &[Port],
    ) -> Result<(), ruggine::Error> {
        let node = self.node(id)?;
        let classic = &node.classic;
        let same = |held: Vec<Port>, given: &[Port]| held.as_slice() == given;
        if !same(self.ports(id, Side::Input).unwrap_or_default(), inputs) {
            let held = classic.inputs().key_list();
            for key in held {
                classic.remove_input(&key);
            }
            for (key, ty) in inputs {
                classic.add_input(key.clone(), Input::new(Socket::new(ty.clone())))?;
            }
        }
        if !same(self.ports(id, Side::Output).unwrap_or_default(), outputs) {
            let held = classic.outputs().key_list();
            for key in held {
                classic.remove_output(&key);
            }
            for (key, ty) in outputs {
                classic.add_output(key.clone(), Output::new(Socket::new(ty.clone())))?;
            }
        }
        Ok(())
    }

    /// The node's ports on one side, in order, with their socket types.
    pub fn ports(&self, id: &str, side: Side) -> Option<Vec<Port>> {
        let node = self.editor.get_node(id)?;
        let classic = node.classic();
        Some(match side {
            Side::Input => classic
                .inputs()
                .iter()
                .map(|(k, p)| (k.to_owned(), p.socket().name.clone()))
                .collect(),
            Side::Output => classic
                .outputs()
                .iter()
                .map(|(k, p)| (k.to_owned(), p.socket().name.clone()))
                .collect(),
        })
    }

    /// Puts the nodes in `order`, which must name every node once; `false` when it doesn't.
    pub fn reorder_nodes(&self, order: &[String]) -> bool {
        let order: Vec<&str> = order.iter().map(String::as_str).collect();
        self.editor.reorder_nodes(&order)
    }

    pub fn node_ids(&self) -> Vec<String> {
        self.editor
            .get_nodes()
            .iter()
            .map(|n| n.id().to_owned())
            .collect()
    }

    /// Every cable, in the editor's order.
    pub fn cables(&self) -> Vec<crate::conduit::Cable> {
        self.editor
            .get_connections()
            .iter()
            .map(|c| crate::conduit::Cable {
                id: c.id().to_owned(),
                source: c.source().to_owned(),
                source_output: c.source_output().to_owned(),
                target: c.target().to_owned(),
                target_input: c.target_input().to_owned(),
            })
            .collect()
    }

    pub fn connection_ids(&self) -> Vec<String> {
        self.editor
            .get_connections()
            .iter()
            .map(|c| c.id().to_owned())
            .collect()
    }
}
