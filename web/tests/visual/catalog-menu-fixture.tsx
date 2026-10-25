import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { CatalogMenu } from "../../src/components/CatalogMenu";
import "../../src/styles/global.css";
import "../../src/styles/navigation.css";

createRoot(document.getElementById("root")!).render(<BrowserRouter><CatalogMenu active={false} /></BrowserRouter>);
