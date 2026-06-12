import sys
import json
import ast
import textwrap

def process_file(source, path):
    try:
        source = textwrap.dedent(source)
        tree = ast.parse(source)
    except SyntaxError:
        return {"nodes": [], "imports": [], "routes": [], "importMap": [], "edges": []}

    class GraphVisitor(ast.NodeVisitor):
        def __init__(self):
            self.nodes = []
            self.imports = []
            self.routes = []
            self.import_map = []
            self.edges = []
            self.current_scope = None

        def add_symbol(self, node, type_name):
            start_line = node.lineno
            end_line = getattr(node, "end_lineno", start_line)
            node_id = f"symbol:{path}:{node.name}"
            
            # Method inside class?
            if self.current_scope and self.current_scope.startswith(f"symbol:{path}:") and type_name == "function":
                type_name = "method"
                
            self.nodes.append({
                "id": node_id,
                "type": type_name,
                "name": node.name,
                "path": path,
                "language": "python",
                "line": start_line,
                "startLine": start_line,
                "endLine": end_line
            })
            return node_id

        def visit_FunctionDef(self, node):
            node_id = self.add_symbol(node, "function")
            
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call):
                    func = decorator.func
                    if isinstance(func, ast.Attribute) and func.attr in ['route', 'get', 'post', 'put', 'delete', 'patch']:
                        if decorator.args and isinstance(decorator.args[0], ast.Constant):
                            route_path = decorator.args[0].value
                            self.routes.append({
                                "id": f"route:{path}:{route_path}",
                                "type": "route",
                                "name": route_path,
                                "path": path,
                                "language": "python",
                                "line": node.lineno
                            })
                            
            old_scope = self.current_scope
            self.current_scope = node_id
            self.generic_visit(node)
            self.current_scope = old_scope

        def visit_AsyncFunctionDef(self, node):
            self.visit_FunctionDef(node)

        def visit_ClassDef(self, node):
            node_id = self.add_symbol(node, "class")
            
            for base in node.bases:
                base_name = None
                if isinstance(base, ast.Name):
                    base_name = base.id
                elif isinstance(base, ast.Attribute):
                    base_name = base.attr
                
                if base_name:
                    self.edges.append({
                        "id": f"extends:{node_id}:symbol:{path}:{base_name}",
                        "type": "extends",
                        "source": node_id,
                        "target": f"symbol:{path}:{base_name}",
                        "evidence": base_name
                    })

            old_scope = self.current_scope
            self.current_scope = node_id
            self.generic_visit(node)
            self.current_scope = old_scope

        def visit_Call(self, node):
            if self.current_scope:
                callee_name = None
                if isinstance(node.func, ast.Name):
                    callee_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    callee_name = node.func.attr
                    
                if callee_name:
                    self.edges.append({
                        "id": f"calls:{self.current_scope}:symbol:{path}:{callee_name}",
                        "type": "calls",
                        "source": self.current_scope,
                        "target": f"symbol:{path}:{callee_name}",
                        "evidence": callee_name,
                        "confidence": 0.5
                    })
                    
            self.generic_visit(node)

        def visit_Import(self, node):
            for alias in node.names:
                self.imports.append(alias.name)
                self.import_map.append([alias.asname or alias.name, alias.name])
            self.generic_visit(node)

        def visit_ImportFrom(self, node):
            if node.module:
                module = node.module
                self.imports.append(module)
                for alias in node.names:
                    self.imports.append(f"{module}.{alias.name}")
                    self.import_map.append([alias.asname or alias.name, f"{module}.{alias.name}"])
            self.generic_visit(node)

    visitor = GraphVisitor()
    visitor.visit(tree)

    return {
        "nodes": visitor.nodes,
        "imports": list(set(visitor.imports)),
        "routes": visitor.routes,
        "importMap": visitor.import_map,
        "edges": visitor.edges
    }

def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            req = json.loads(line)
            req_id = req.get("id")
            source = req.get("source", "")
            path = req.get("path", "")

            result = process_file(source, path)
            resp = {"id": req_id, "result": result}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"id": req.get("id", -1), "error": str(e)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
